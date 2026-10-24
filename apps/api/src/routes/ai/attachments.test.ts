import { readFileSync } from "node:fs";
import {
  aiAttachment,
  aiChatThread,
  storageDeletion,
  transaction,
  transactionAttachment,
} from "@strictbudget/db/schema";
import { fakeText } from "@tanstack/ai/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createBudget,
  createTestApp,
  resetDatabase,
  runJobs,
  shareBudget,
  signUp,
} from "../../../test/helpers";
import type { MemoryStorage } from "../../lib/storage";

const model = fakeText();
const t = createTestApp({ envOverrides: { AI_API_KEY: "test-key" }, aiAdapter: model });
const storage = t.storage as MemoryStorage;
beforeEach(async () => {
  await resetDatabase(t.db);
  storage.objects.clear();
});
afterAll(() => t.close());

/** The smallest real PNG: a 1×1 transparent pixel. */
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (ch) => ch.charCodeAt(0),
);
const PNG_BASE64 = Buffer.from(PNG).toString("base64");
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0)]);

const json = async <T>(res: Response) => (await res.json()) as T;
const errorCode = async (res: Response) =>
  (await json<{ error: { code: string } }>(res)).error.code;

function send(method: string, path: string, cookie: string, body?: unknown) {
  return t.app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function upload(
  path: string,
  cookie: string,
  file: { bytes: Uint8Array; name: string },
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.append("file", new File([file.bytes as Uint8Array<ArrayBuffer>], file.name));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return t.app.request(path, { method: "POST", headers: { cookie }, body: form });
}

async function setup() {
  const owner = await signUp(t.app);
  const budget = await createBudget(t.app, owner.cookie);
  const ai = `/v1/budgets/${budget.id}/ai`;
  await send("PATCH", ai, owner.cookie, { enabled: true });
  const account = await json<{ id: string }>(
    await send("POST", `/v1/budgets/${budget.id}/accounts`, owner.cookie, {
      name: "Checking",
      type: "checking",
      balance: "0",
      date: "2026-10-01",
    }),
  );
  return { owner, budget, ai, account };
}

type Uploaded = { id: string; fileName: string; contentType: string; byteSize: number };

type ChatEvent = { type: string; delta?: string; outcome?: { interrupts?: { id: string }[] } };

/** One chat run, as the app's chat client sends it: `parts` are the user message's AG-UI content. */
async function chat(
  cookie: string,
  budgetId: string,
  body: {
    threadId: string;
    parts?: unknown[];
    resume?: unknown[];
    parentRunId?: string;
  },
) {
  const res = await send("POST", `/v1/budgets/${budgetId}/ai/chat`, cookie, {
    threadId: body.threadId,
    runId: crypto.randomUUID(),
    messages: body.parts ? [{ id: crypto.randomUUID(), role: "user", content: body.parts }] : [],
    ...(body.resume ? { resume: body.resume, parentRunId: body.parentRunId } : {}),
    state: {},
    tools: [],
    context: [],
    forwardedProps: { today: "2026-10-18" },
  });
  if (res.status !== 200) return { status: res.status, res, events: [] as ChatEvent[], text: "" };
  const events = (await res.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
  const text = events
    .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
    .map((e) => e.delta)
    .join("");
  return { status: res.status, res, events, text };
}

const pointer = (a: Uploaded, type = "image") => ({
  type,
  source: { type: "url", value: `strictbudget-attachment:${a.id}`, mimeType: a.contentType },
  metadata: { attachmentId: a.id, fileName: a.fileName },
});

describe("AI attachments", () => {
  it("are kept in object storage, private to the person who uploaded them", async () => {
    const { owner, budget, ai } = await setup();
    const res = await upload(`${ai}/attachments`, owner.cookie, {
      bytes: PNG,
      name: "../receipt.png",
    });
    expect(res.status).toBe(201);
    const file = await json<Uploaded>(res);
    expect(file).toMatchObject({
      fileName: "receipt.png",
      contentType: "image/png",
      byteSize: PNG.byteLength,
    });
    const [row] = await t.db.select().from(aiAttachment).where(eq(aiAttachment.id, file.id));
    // The database holds where the file is, never the file.
    expect(row?.storageKey).toBe(`budgets/${budget.id}/ai-attachments/${file.id}`);
    expect(storage.objects.get(row?.storageKey ?? "")?.body).toEqual(PNG);

    const own = await send("GET", `${ai}/attachments/${file.id}`, owner.cookie);
    expect(own.status).toBe(200);
    expect(new Uint8Array(await own.arrayBuffer())).toEqual(PNG);
    const partner = await shareBudget(t.app, owner.cookie, budget.id);
    expect((await send("GET", `${ai}/attachments/${file.id}`, partner.cookie)).status).toBe(404);
  });

  it("take what the assistant can read, and say what it can't", async () => {
    const { owner, ai } = await setup();
    const csv = await upload(`${ai}/attachments`, owner.cookie, {
      bytes: new TextEncoder().encode("Date,Payee,Amount\n2026-10-03,Grocer,-42.17\n"),
      name: "bank.csv",
    });
    expect(await json<Uploaded>(csv)).toMatchObject({ contentType: "text/csv" });
    const xlsx = await upload(`${ai}/attachments`, owner.cookie, {
      bytes: readFileSync(new URL("../../../test/fixtures/statement.xlsx", import.meta.url)),
      name: "statement.xlsx",
    });
    expect(await json<Uploaded>(xlsx)).toMatchObject({
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    // Claude's 5 MB image limit is on the base64, so a photo's file can be at most 3.75 MB.
    const big = new Uint8Array(4 * 1024 * 1024);
    big.set(PNG);
    const tooBig = await upload(`${ai}/attachments`, owner.cookie, { bytes: big, name: "big.png" });
    expect(tooBig.status).toBe(413);
    const zip = await upload(`${ai}/attachments`, owner.cookie, { bytes: ZIP, name: "a.zip" });
    expect(zip.status).toBe(415);
    expect(await errorCode(zip)).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("are refused while AI is off, and to viewers", async () => {
    const { owner, budget, ai } = await setup();
    const viewer = await shareBudget(t.app, owner.cookie, budget.id, {
      name: "Vic",
      role: "viewer",
    });
    const asViewer = await upload(`${ai}/attachments`, viewer.cookie, {
      bytes: PNG,
      name: "a.png",
    });
    expect(asViewer.status).toBe(403);
    await send("PATCH", ai, owner.cookie, { enabled: false });
    const off = await upload(`${ai}/attachments`, owner.cookie, { bytes: PNG, name: "a.png" });
    expect(off.status).toBe(403);
    expect(await errorCode(off)).toBe("AI_DISABLED");
  });

  it("reach the model as files, while the transcript keeps only pointers", async () => {
    const { owner, budget, ai } = await setup();
    const photo = await json<Uploaded>(
      await upload(`${ai}/attachments`, owner.cookie, { bytes: PNG, name: "receipt.png" }),
    );
    const sheet = await json<Uploaded>(
      await upload(`${ai}/attachments`, owner.cookie, {
        bytes: readFileSync(new URL("../../../test/fixtures/statement.xlsx", import.meta.url)),
        name: "statement.xlsx",
      }),
    );
    let seen: unknown[] = [];
    model.setResponses([
      ({ request }) => {
        seen = request.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
        return { text: "A $42.17 grocery receipt." };
      },
    ]);
    const threadId = crypto.randomUUID();
    const reply = await chat(owner.cookie, budget.id, {
      threadId,
      parts: [{ type: "text", text: "What's this?" }, pointer(photo), pointer(sheet, "document")],
    });
    expect(reply.text).toBe("A $42.17 grocery receipt.");
    // The photo as image data, the workbook as CSV text, each named with its attachment id.
    expect(seen).toContainEqual({
      type: "image",
      source: { type: "data", value: PNG_BASE64, mimeType: "image/png" },
    });
    const texts = seen.flatMap((p) =>
      (p as { type: string }).type === "text" ? [(p as { content: string }).content] : [],
    );
    expect(texts).toContain(`Attached file "receipt.png" (image/png, attachment id ${photo.id}):`);
    expect(texts.join("\n")).toContain(
      'Sheet "October":\nDate,Payee,Amount\n2026-10-03,Corner Grocer,42.17\n2026-10-05,Gas & Go,-30.5',
    );

    // Stored: pointers with the file's own name and type, no bytes.
    const [stored] = await t.db
      .select({ messages: aiChatThread.messages })
      .from(aiChatThread)
      .where(eq(aiChatThread.threadId, threadId));
    const text = JSON.stringify(stored?.messages);
    expect(text).not.toContain(PNG_BASE64);
    expect(text).toContain(`strictbudget-attachment:${photo.id}`);
    const state = await json<{ messages: { role: string; parts: { type: string }[] }[] }>(
      await send("GET", `${ai}/chat?threadId=${threadId}`, owner.cookie),
    );
    expect(state.messages[0]?.parts.map((p) => p.type)).toEqual(["text", "image", "document"]);
    // The conversation is named by its text; the files now belong to it.
    const [row] = await t.db.select().from(aiAttachment).where(eq(aiAttachment.id, photo.id));
    expect(row?.conversationId).toBe(threadId);
    const removed = await send("DELETE", `${ai}/attachments/${photo.id}`, owner.cookie);
    expect(removed.status).toBe(409);
  });

  it("send text files within a budget per model call, naming the rest", async () => {
    const { owner, budget, ai } = await setup();
    const statement = async (n: number) =>
      json<Uploaded>(
        await upload(`${ai}/attachments`, owner.cookie, {
          bytes: new TextEncoder().encode(
            `Statement ${n}\n${"2026-10-03,Grocer,-42.17\n".repeat(7000)}`,
          ),
          name: `statement-${n}.csv`,
        }),
      );
    const files = [await statement(1), await statement(2), await statement(3)];
    let texts: string[] = [];
    model.setResponses([
      ({ request }) => {
        texts = request.messages.flatMap((m) =>
          Array.isArray(m.content)
            ? m.content.flatMap((p) => (p.type === "text" ? [p.content] : []))
            : [],
        );
        return { text: "Read them." };
      },
    ]);
    await chat(owner.cookie, budget.id, {
      threadId: crypto.randomUUID(),
      parts: files.map((f) => pointer(f, "document")),
    });
    // About 175k characters each: two fit, the third is named instead of sent.
    expect(texts.filter((t) => t.startsWith("Statement "))).toHaveLength(2);
    expect(texts.at(-1)).toMatch(/"statement-3\.csv" is left out of this request/);
  });

  it("can't send a file that wasn't uploaded, or someone else's", async () => {
    const { owner, budget, ai } = await setup();
    const inline = await chat(owner.cookie, budget.id, {
      threadId: crypto.randomUUID(),
      parts: [
        { type: "image", source: { type: "data", value: PNG_BASE64, mimeType: "image/png" } },
      ],
    });
    expect(inline.status).toBe(400);
    expect(await errorCode(inline.res)).toBe("INVALID_ATTACHMENT");

    const partner = await shareBudget(t.app, owner.cookie, budget.id);
    const theirs = await json<Uploaded>(
      await upload(`${ai}/attachments`, partner.cookie, { bytes: PNG, name: "theirs.png" }),
    );
    const borrowed = await chat(owner.cookie, budget.id, {
      threadId: crypto.randomUUID(),
      parts: [pointer(theirs)],
    });
    expect(borrowed.status).toBe(400);
    expect(await errorCode(borrowed.res)).toBe("ATTACHMENT_NOT_FOUND");
    // A refused send leaves no conversation behind.
    const list = await json<{ conversations: unknown[] }>(
      await send("GET", `${ai}/conversations`, owner.cookie),
    );
    expect(list.conversations).toEqual([]);
  });

  it("attaches a receipt to the transaction it records, once approved", async () => {
    const { owner, budget, ai, account } = await setup();
    const photo = await json<Uploaded>(
      await upload(`${ai}/attachments`, owner.cookie, { bytes: PNG, name: "receipt.png" }),
    );
    const created = await json<{ id: string }>(
      await send("POST", `/v1/budgets/${budget.id}/transactions`, owner.cookie, {
        accountId: account.id,
        date: "2026-10-18",
        amount: "-4217",
        payeeName: "Corner Grocer",
        categoryId: null,
      }),
    );
    model.setResponses([
      {
        toolCalls: [
          {
            name: "attachFileToTransaction",
            input: {
              summary: "Attach receipt.png to the Corner Grocer transaction.",
              attachmentId: photo.id,
              transactionId: created.id,
            },
          },
        ],
      },
    ]);
    const threadId = crypto.randomUUID();
    const paused = await chat(owner.cookie, budget.id, {
      threadId,
      parts: [{ type: "text", text: "Attach this" }, pointer(photo)],
    });
    const pause = paused.events.findLast((e) => e.type === "RUN_FINISHED") as ChatEvent & {
      runId?: string;
    };
    expect(pause.outcome?.interrupts).toHaveLength(1);
    expect(await t.db.select().from(transactionAttachment)).toEqual([]);

    model.setResponses([{ text: "Attached." }]);
    const approved = await chat(owner.cookie, budget.id, {
      threadId,
      parentRunId: pause.runId,
      resume: pause.outcome?.interrupts?.map((i) => ({
        interruptId: i.id,
        status: "resolved",
        payload: true,
      })),
    });
    expect(approved.text).toBe("Attached.");
    const [attached] = await t.db
      .select()
      .from(transactionAttachment)
      .where(eq(transactionAttachment.transactionId, created.id));
    expect(attached).toMatchObject({ fileName: "receipt.png", contentType: "image/png" });
    expect(storage.objects.get(attached?.storageKey ?? "")?.body).toEqual(PNG);
  });

  it("go with their conversation, and unsent ones after a day", async () => {
    const { owner, budget, ai } = await setup();
    const sent = await json<Uploaded>(
      await upload(`${ai}/attachments`, owner.cookie, { bytes: PNG, name: "sent.png" }),
    );
    const unsent = await json<Uploaded>(
      await upload(`${ai}/attachments`, owner.cookie, { bytes: PNG, name: "unsent.png" }),
    );
    const dropped = await json<Uploaded>(
      await upload(`${ai}/attachments`, owner.cookie, { bytes: PNG, name: "dropped.png" }),
    );
    model.setResponses([{ text: "Got it." }]);
    const threadId = crypto.randomUUID();
    await chat(owner.cookie, budget.id, { threadId, parts: [pointer(sent)] });

    // Removed before sending: gone at once.
    expect((await send("DELETE", `${ai}/attachments/${dropped.id}`, owner.cookie)).status).toBe(
      204,
    );
    // Deleting the conversation deletes its files.
    expect((await send("DELETE", `${ai}/conversations/${threadId}`, owner.cookie)).status).toBe(
      204,
    );
    const queued = (await t.db.select().from(storageDeletion)).map((r) => r.storageKey).sort();
    expect(queued).toEqual(
      [
        `budgets/${budget.id}/ai-attachments/${sent.id}`,
        `budgets/${budget.id}/ai-attachments/${dropped.id}`,
      ].sort(),
    );
    await runJobs(t.app);
    expect(storage.objects.has(`budgets/${budget.id}/ai-attachments/${sent.id}`)).toBe(false);

    // An unsent file stays a day, then the purge takes it.
    await t.db
      .update(aiAttachment)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(aiAttachment.id, unsent.id));
    await send("DELETE", `${ai}/attachments/${dropped.id}`, owner.cookie);
    await t.jobs.send(t.db, "storage.purge", null);
    await runJobs(t.app);
    expect(await t.db.select().from(aiAttachment)).toEqual([]);
    expect(storage.objects.size).toBe(0);
  });
});

type Draft = {
  found: boolean;
  date: string | null;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  memo: string | null;
  amount: string | null;
  lines: { categoryId: string; memo: string | null; amount: string }[];
  note: string | null;
};

describe("Filling in a transaction from a receipt", () => {
  async function withLists() {
    const s = await setup();
    const categories = await json<{
      groups: { name: string; categories: { id: string; name: string }[] }[];
    }>(await send("GET", `/v1/budgets/${s.budget.id}/categories`, s.owner.cookie));
    const all = categories.groups.flatMap((g) => g.categories);
    const groceries = all.find((c) => c.name === "Groceries") ?? all[0];
    const other = all.find((c) => c !== groceries);
    // A payee the budget already has.
    await send("POST", `/v1/budgets/${s.budget.id}/transactions`, s.owner.cookie, {
      accountId: s.account.id,
      date: "2026-10-02",
      amount: "-100",
      payeeName: "Walmart",
      categoryId: null,
    });
    return { ...s, groceries, other };
  }

  const draft = (path: string, cookie: string, accountId: string) =>
    upload(
      `${path}/transaction-draft`,
      cookie,
      { bytes: PNG, name: "receipt.png" },
      {
        accountId,
        today: "2026-10-18",
      },
    );

  it("reads the file, choosing from the budget's own payees and categories", async () => {
    const { owner, ai, account, groceries } = await withLists();
    let prompt = "";
    let parts: unknown[] = [];
    model.setResponses([
      ({ request }) => {
        prompt = JSON.stringify(request.systemPrompts);
        parts = request.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
        return {
          text: JSON.stringify({
            found: true,
            date: "2026-10-17",
            payeeId: null,
            // Not in the list by id, but the same name: it's that payee.
            newPayeeName: "WALMART",
            direction: "outflow",
            total: "42.17",
            currency: "USD",
            categoryId: groceries?.id,
            lines: [],
            memo: "Weekly shop",
            note: null,
          }),
        };
      },
    ]);
    const res = await draft(ai, owner.cookie, account.id);
    expect(res.status).toBe(200);
    const body = await json<Draft>(res);
    expect(body).toMatchObject({
      found: true,
      date: "2026-10-17",
      payeeName: "Walmart",
      categoryId: groceries?.id,
      memo: "Weekly shop",
      amount: "-4217",
      lines: [],
      note: null,
    });
    expect(body.payeeId).toEqual(expect.any(String));
    // The model was given every payee and category, and the photo itself.
    expect(prompt).toContain("| Walmart");
    expect(prompt).toContain(`${groceries?.id} | `);
    expect(parts).toContainEqual({
      type: "image",
      source: { type: "data", value: PNG_BASE64, mimeType: "image/png" },
    });
    // Nothing is kept: no file, no transaction.
    expect(storage.objects.size).toBe(0);
    expect(await t.db.select().from(aiAttachment)).toEqual([]);
  });

  it("keeps a split only when it adds up, and drops what doesn't check out", async () => {
    const { owner, ai, account, groceries, other } = await withLists();
    const answer = (patch: object) => ({
      text: JSON.stringify({
        found: true,
        date: "Oct 17",
        payeeId: "not-a-payee",
        newPayeeName: "Corner Grocer",
        direction: "outflow",
        total: "30.00",
        currency: null,
        categoryId: "not-a-category",
        lines: [],
        memo: null,
        note: null,
        ...patch,
      }),
    });
    model.setResponses([
      answer({
        lines: [
          { categoryId: groceries?.id, amount: "20.00", memo: "Food" },
          { categoryId: other?.id, amount: "10.00", memo: null },
        ],
      }),
      answer({
        lines: [
          { categoryId: groceries?.id, amount: "20.00", memo: "Food" },
          { categoryId: other?.id, amount: "9.99", memo: null },
        ],
      }),
      answer({ currency: "EUR", direction: "inflow" }),
    ]);
    const split = await json<Draft>(await draft(ai, owner.cookie, account.id));
    expect(split).toMatchObject({
      date: null,
      payeeId: null,
      payeeName: "Corner Grocer",
      categoryId: null,
      amount: "-3000",
      lines: [
        { categoryId: groceries?.id, memo: "Food", amount: "-2000" },
        { categoryId: other?.id, memo: null, amount: "-1000" },
      ],
    });
    const off = await json<Draft>(await draft(ai, owner.cookie, account.id));
    expect(off.lines).toEqual([]);
    const foreign = await json<Draft>(await draft(ai, owner.cookie, account.id));
    expect(foreign.amount).toBeNull();
    expect(foreign.note).toMatch(/in EUR, not USD/);
  });

  it("is only for people who can add transactions, with AI on", async () => {
    const { owner, budget, ai, account } = await setup();
    const viewer = await shareBudget(t.app, owner.cookie, budget.id, {
      name: "Vic",
      role: "viewer",
    });
    expect((await draft(ai, viewer.cookie, account.id)).status).toBe(403);
    const elsewhere = await draft(ai, owner.cookie, "no-such-account");
    expect(elsewhere.status).toBe(400);
    await send("PATCH", ai, owner.cookie, { enabled: false });
    const off = await draft(ai, owner.cookie, account.id);
    expect(off.status).toBe(403);
    expect(await errorCode(off)).toBe("AI_DISABLED");
    expect(await t.db.select().from(transaction).where(eq(transaction.memo, "x"))).toEqual([]);
  });
});
