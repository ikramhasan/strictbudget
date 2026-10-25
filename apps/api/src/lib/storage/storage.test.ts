import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseEnv } from "../../env";
import { attachmentType } from "./file-type";
import { createStorage, DiskStorage, MemoryStorage, S3Storage } from "./index";
import { contentDisposition } from "./s3";

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const base = {
  DATABASE_URL: "postgres://localhost/x",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:5173",
};

describe("DiskStorage", () => {
  it("stores, reads and deletes files under its directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "strictbudget-storage-"));
    dirs.push(root);
    const disk = new DiskStorage(root);
    await disk.put("budgets/b1/attachments/a1", new Uint8Array([1, 2, 3]));
    expect(await disk.get("budgets/b1/attachments/a1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await disk.signedUrl()).toBeNull();
    await disk.delete(["budgets/b1/attachments/a1", "budgets/b1/attachments/missing"]);
    expect(await disk.get("budgets/b1/attachments/a1")).toBeNull();
  });

  it("refuses keys that leave its directory", async () => {
    const disk = new DiskStorage(join(tmpdir(), "strictbudget-storage-x"));
    await expect(disk.put("../escape", new Uint8Array(1))).rejects.toThrow(
      /outside the storage directory/,
    );
  });
});

describe("createStorage", () => {
  it("uses the bucket when S3 is configured, disk in development, nothing in production", () => {
    const s3 = parseEnv({
      ...base,
      NODE_ENV: "production",
      RESEND_API_KEY: "re_x",
      FROM_EMAIL: "example.com",
      S3_BUCKET: "strictbudget-abc",
      S3_ENDPOINT: "https://t3.storageapi.dev",
      S3_ACCESS_KEY_ID: "id",
      S3_SECRET_ACCESS_KEY: "secret",
    });
    expect(s3.S3_REGION).toBe("auto");
    expect(createStorage(s3)).toBeInstanceOf(S3Storage);
    expect(createStorage(parseEnv({ ...base, NODE_ENV: "development" }))).toBeInstanceOf(
      DiskStorage,
    );
    expect(
      createStorage(
        parseEnv({ ...base, NODE_ENV: "production", RESEND_API_KEY: "re_x", FROM_EMAIL: "a.b" }),
      ),
    ).toBeNull();
    expect(createStorage(parseEnv({ ...base, NODE_ENV: "test" }))).toBeInstanceOf(MemoryStorage);
  });

  it("needs a bucket's keys with its name", () => {
    expect(() => parseEnv({ ...base, S3_BUCKET: "b" })).toThrow(/S3_ACCESS_KEY_ID/);
  });
});

describe("S3Storage", () => {
  it("signs download links that name the file", async () => {
    const s3 = new S3Storage({
      bucket: "strictbudget-abc",
      endpoint: "https://t3.storageapi.dev",
      region: "auto",
      accessKeyId: "id",
      secretAccessKey: "secret",
      forcePathStyle: false,
    });
    const url = new URL(
      (await s3.signedUrl("budgets/b/attachments/a", {
        fileName: "Receipt é.pdf",
        contentType: "application/pdf",
        download: true,
      })) ?? "",
    );
    expect(url.host).toBe("strictbudget-abc.t3.storageapi.dev");
    expect(url.pathname).toBe("/budgets/b/attachments/a");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      contentDisposition("Receipt é.pdf", true),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");

    // An SVG is never served as a page from the bucket's origin.
    const svg = new URL(
      (await s3.signedUrl("k", {
        fileName: "logo.svg",
        contentType: "image/svg+xml",
        download: false,
      })) ?? "",
    );
    expect(svg.searchParams.get("response-content-disposition")).toMatch(/^attachment;/);
  });
});

describe("attachmentType", () => {
  const bytes = (...b: number[]) => {
    const out = new Uint8Array(64);
    out.set(b);
    return out;
  };
  it("reads the type from the contents", async () => {
    expect(await attachmentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(await attachmentType(new TextEncoder().encode("GIF89a\x01\x00\x01\x00"))).toBe(
      "image/gif",
    );
    expect(await attachmentType(new TextEncoder().encode("<svg viewBox='0 0 1 1'/>"))).toBe(
      "image/svg+xml",
    );
    expect(await attachmentType(new TextEncoder().encode("<html><svg/></html>"))).toBeNull();
    expect(await attachmentType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
  });
});

describe("contentDisposition", () => {
  it("keeps any name, with an ASCII fallback", () => {
    expect(contentDisposition('a"b\\é.png', false)).toBe(
      `inline; filename="a_b__.png"; filename*=UTF-8''a%22b%5C%C3%A9.png`,
    );
  });
});
