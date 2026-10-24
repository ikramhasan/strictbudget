import { storageDeletion, transactionAttachment } from "@strictbudget/db/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  runJobs,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import { MemoryStorage } from "../../lib/storage";
import { MAX_ATTACHMENT_BYTES } from "../../lib/storage/file-type";

const storage = new MemoryStorage();
const { app, db, jobs, close } = createTestApp({ storage });
/** Runs the purge now rather than on its schedule (a cascade queues no job of its own). */
async function purge() {
  await jobs.send(db, "storage.purge", null);
  await runJobs(app);
}
beforeEach(async () => {
  await resetDatabase(db);
  storage.objects.clear();
});
afterAll(close);

type Attachment = {
  id: string;
  transactionId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
};
type Txn = {
  id: string;
  accountId: string;
  transferTransactionId: string | null;
  attachment: Attachment | null;
};
type ErrorBody = { error: { code: string } };

const TODAY = "2026-10-01";
/** The smallest real PNG: a 1×1 transparent pixel. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (ch) => ch.charCodeAt(0),
);
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const SVG = new TextEncoder().encode(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
);

function send(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response) => (await res.json()) as T;

async function setup() {
  const { cookie } = await signUp(app);
  const budget = await createBudget(app, cookie);
  const base = `/v1/budgets/${budget.id}`;
  const addAccount = async (name: string) =>
    json<{ id: string }>(
      await send("POST", `${base}/accounts`, cookie, {
        name,
        type: "checking",
        balance: "100000",
        date: TODAY,
      }),
    );
  const add = async (input: Record<string, unknown>) => {
    const res = await send("POST", `${base}/transactions`, cookie, {
      date: TODAY,
      payeeName: "Shop",
      categoryId: null,
      amount: "-500",
      ...input,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return json<Txn>(res);
  };
  const find = async (id: string) =>
    (
      await json<{ transactions: Txn[] }>(await send("GET", `${base}/transactions`, cookie))
    ).transactions.find((t) => t.id === id);
  const upload = (
    id: string,
    bytes: Uint8Array,
    name = "receipt.png",
    type = "image/png",
    as = cookie,
  ) => {
    const form = new FormData();
    form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
    return app.request(`${base}/transactions/${id}/attachment`, {
      method: "POST",
      headers: { cookie: as },
      body: form,
    });
  };
  return { cookie, budget, base, addAccount, add, find, upload };
}

describe("transaction attachments", () => {
  it("attaches a photo, shows it on the row, serves it, and deletes it with its file", async () => {
    const { cookie, base, addAccount, add, find, upload } = await setup();
    const checking = await addAccount("Checking");
    const txn = await add({ accountId: checking.id });
    expect((await find(txn.id))?.attachment).toBeNull();

    // The browser's type is ignored: the contents say PNG.
    const res = await upload(txn.id, PNG, "IMG_0001.png", "application/octet-stream");
    expect(res.status, await res.clone().text()).toBe(201);
    const attachment = await json<Attachment>(res);
    expect(attachment).toMatchObject({
      transactionId: txn.id,
      fileName: "IMG_0001.png",
      contentType: "image/png",
      byteSize: PNG.byteLength,
    });
    expect((await find(txn.id))?.attachment).toMatchObject({ id: attachment.id });
    expect(storage.objects.size).toBe(1);

    const served = await send("GET", `${base}/transactions/${txn.id}/attachment`, cookie);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("content-disposition")).toMatch(/^inline; filename="IMG_0001.png"/);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
    const download = await send(
      "GET",
      `${base}/transactions/${txn.id}/attachment?download=true`,
      cookie,
    );
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);

    expect((await send("DELETE", `${base}/transactions/${txn.id}/attachment`, cookie)).status).toBe(
      204,
    );
    expect((await find(txn.id))?.attachment).toBeNull();
    // The file goes once the purge job runs.
    expect(storage.objects.size).toBe(1);
    await runJobs(app);
    expect(storage.objects.size).toBe(0);
    expect(await db.select().from(storageDeletion)).toEqual([]);
    expect((await send("GET", `${base}/transactions/${txn.id}/attachment`, cookie)).status).toBe(
      404,
    );
  });

  it("takes PDFs and SVGs, and refuses other files, empty ones and ones over 15 MB", async () => {
    const { addAccount, add, upload } = await setup();
    const checking = await addAccount("Checking");
    const pdf = await upload((await add({ accountId: checking.id })).id, PDF, "bill.pdf", "");
    expect(await json<Attachment>(pdf)).toMatchObject({ contentType: "application/pdf" });
    const svg = await upload((await add({ accountId: checking.id })).id, SVG, "logo.svg");
    expect(await json<Attachment>(svg)).toMatchObject({ contentType: "image/svg+xml" });

    const txn = await add({ accountId: checking.id });
    const text = await upload(txn.id, new TextEncoder().encode("hello"), "notes.png");
    expect(text.status).toBe(415);
    expect((await json<ErrorBody>(text)).error.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect((await upload(txn.id, new Uint8Array(0))).status).toBe(400);
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(PNG);
    const tooBig = await upload(txn.id, big);
    expect(tooBig.status).toBe(413);
    expect((await json<ErrorBody>(tooBig)).error.code).toBe("FILE_TOO_LARGE");
    // Exactly 15 MB is fine.
    expect((await upload(txn.id, big.subarray(0, MAX_ATTACHMENT_BYTES))).status).toBe(201);
  });

  it("allows one per transaction: delete it to add another", async () => {
    const { addAccount, add, upload } = await setup();
    const txn = await add({ accountId: (await addAccount("Checking")).id });
    expect((await upload(txn.id, PNG)).status).toBe(201);
    const again = await upload(txn.id, PNG);
    expect(again.status).toBe(409);
    expect((await json<ErrorBody>(again)).error.code).toBe("ATTACHMENT_EXISTS");
  });

  it("shares one attachment between a transfer's sides, deleted from either", async () => {
    const { cookie, base, addAccount, add, find, upload } = await setup();
    const checking = await addAccount("Checking");
    const savings = await addAccount("Savings");
    const out = await add({
      accountId: checking.id,
      payeeName: null,
      transferAccountId: savings.id,
    });
    const otherId = out.transferTransactionId ?? "";
    const attachment = await json<Attachment>(await upload(out.id, PNG));
    expect((await find(otherId))?.attachment).toMatchObject({ id: attachment.id });
    // The other side can't take a second one.
    expect((await upload(otherId, PNG)).status).toBe(409);
    expect((await send("GET", `${base}/transactions/${otherId}/attachment`, cookie)).status).toBe(
      200,
    );
    expect(
      (await send("DELETE", `${base}/transactions/${otherId}/attachment`, cookie)).status,
    ).toBe(204);
    expect((await find(out.id))?.attachment).toBeNull();
    // Both sides' histories show it, added and deleted.
    const history = await json<{ events: { entity: string; op: string }[] }>(
      await send("GET", `${base}/transactions/${out.id}/history`, cookie),
    );
    expect(
      history.events.filter((e) => e.entity === "transaction_attachment").map((e) => e.op),
    ).toEqual(["insert", "delete"]);
  });

  it("keeps a transfer's attachment when it stops being a transfer", async () => {
    const { cookie, base, addAccount, add, find, upload } = await setup();
    const checking = await addAccount("Checking");
    const savings = await addAccount("Savings");
    const out = await add({
      accountId: checking.id,
      payeeName: null,
      transferAccountId: savings.id,
    });
    // Added on the side that goes away.
    await upload(out.transferTransactionId ?? "", PNG);
    const res = await send("PATCH", `${base}/transactions/${out.id}`, cookie, {
      payeeName: "Bank",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await find(out.id))?.attachment).toMatchObject({ transactionId: out.id });
    await runJobs(app);
    expect(storage.objects.size).toBe(1);
  });

  it("goes with its transaction, account and budget, files included", async () => {
    const { cookie, base, addAccount, add, upload } = await setup();
    const checking = await addAccount("Checking");
    const first = await add({ accountId: checking.id });
    await upload(first.id, PNG);
    expect((await send("DELETE", `${base}/transactions/${first.id}`, cookie)).status).toBe(204);
    await purge();
    expect(storage.objects.size).toBe(0);

    // An account with only its starting balance can be deleted; its attachment goes with it.
    const savings = await addAccount("Savings");
    const [start] = (
      await json<{ transactions: Txn[] }>(
        await send("GET", `${base}/transactions?accountId=${savings.id}`, cookie),
      )
    ).transactions;
    await upload(start?.id ?? "", PNG);
    expect((await send("DELETE", `${base}/accounts/${savings.id}`, cookie)).status).toBe(204);
    await purge();
    expect(storage.objects.size).toBe(0);

    await upload((await add({ accountId: checking.id })).id, PNG);
    expect((await send("DELETE", base, cookie)).status).toBe(204);
    await purge();
    expect(storage.objects.size).toBe(0);
    expect(await db.select().from(transactionAttachment)).toEqual([]);
  });

  it("lets viewers open attachments but not add or delete them", async () => {
    const { cookie, budget, base, addAccount, add, upload } = await setup();
    const txn = await add({ accountId: (await addAccount("Checking")).id });
    const viewer = await shareBudget(app, cookie, budget.id, { role: "viewer" });
    expect((await upload(txn.id, PNG, "a.png", "image/png", viewer.cookie)).status).toBe(403);
    await upload(txn.id, PNG);
    expect(
      (await send("GET", `${base}/transactions/${txn.id}/attachment`, viewer.cookie)).status,
    ).toBe(200);
    expect(
      (await send("DELETE", `${base}/transactions/${txn.id}/attachment`, viewer.cookie)).status,
    ).toBe(403);

    // Not a member: as if it didn't exist.
    const stranger = await signUp(app);
    expect(
      (await send("GET", `${base}/transactions/${txn.id}/attachment`, stranger.cookie)).status,
    ).toBe(404);
  });

  it("is turned off without storage", async () => {
    const off = createTestApp({ storage: null });
    try {
      const { cookie } = await signUp(off.app);
      const budget = await createBudget(off.app, cookie);
      const form = new FormData();
      form.append("file", new File([PNG], "a.png"));
      const res = await off.app.request(`/v1/budgets/${budget.id}/transactions/x/attachment`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
      expect(res.status).toBe(503);
      expect((await json<ErrorBody>(res)).error.code).toBe("ATTACHMENTS_DISABLED");
    } finally {
      await off.close();
    }
  });
});
