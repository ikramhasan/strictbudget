import type { Capability } from "@better-auth/agent-auth";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { buildOpenApiDocument } from "../docs";
import {
  type AgentOperation,
  agentOperations,
  type FileArgument,
  type OpenApiDocument,
} from "./operations";
import { AGENT_PRINCIPAL, type AgentPrincipal } from "./principal";

export type OperationResult =
  | { ok: boolean; status: number; kind: "json"; data: unknown }
  | { ok: boolean; status: number; kind: "text"; contentType: string; text: string }
  | { ok: true; status: number; kind: "binary"; contentType: string; base64: string }
  | { ok: true; status: number; kind: "redirect"; location: string }
  | { ok: true; status: number; kind: "empty" };

/** An operation's argument error, answered in the API's error shape without calling it. */
const invalid = (message: string): OperationResult => ({
  ok: false,
  status: 400,
  kind: "json",
  data: { error: { code: "INVALID_ARGUMENTS", message } },
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isFileArgument(v: unknown): v is FileArgument {
  return isRecord(v) && typeof v.fileName === "string" && typeof v.base64 === "string";
}

/** The request an operation's arguments make, or a reason they don't make one. */
function buildRequest(op: AgentOperation, args: Record<string, unknown>): Request | string {
  let path = op.path;
  for (const name of op.pathParams) {
    const value = args[name];
    if ((typeof value !== "string" && typeof value !== "number") || value === "") {
      return `"${name}" is required`;
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const query = new URLSearchParams();
  for (const name of op.queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(name, String(v));
  }
  const known = new Set([...op.pathParams, ...op.queryParams, "body"]);
  const unknown = Object.keys(args).filter((k) => !known.has(k));
  if (unknown.length > 0)
    return `Unknown argument${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`;

  const qs = query.toString();
  const url = `http://agent.internal${path}${qs ? `?${qs}` : ""}`;
  const init: RequestInit = { method: op.method, headers: {} };
  const body = args.body;
  if (op.body?.kind === "json" && body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  } else if (op.body?.kind === "multipart") {
    if (!isRecord(body)) return '"body" is required';
    const form = new FormData();
    for (const [field, value] of Object.entries(body)) {
      if (op.body.fileFields.includes(field)) {
        if (!isFileArgument(value)) return `"body.${field}" must be { fileName, base64 }`;
        const bytes = Buffer.from(value.base64, "base64");
        if (bytes.length === 0) return `"body.${field}.base64" is empty or not base64`;
        form.append(
          field,
          new File([bytes], value.fileName, {
            type: value.contentType ?? "application/octet-stream",
          }),
        );
      } else if (value !== undefined && value !== null) {
        form.append(field, typeof value === "string" ? value : JSON.stringify(value));
      }
    }
    init.body = form;
  } else if (body !== undefined && !op.body) {
    return `${op.name} takes no body`;
  }
  return new Request(url, init);
}

async function readResult(res: Response): Promise<OperationResult> {
  const { status, ok } = res;
  if (status >= 300 && status < 400) {
    const location = res.headers.get("location");
    if (location) return { ok: true, status, kind: "redirect", location };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (status === 204 || res.body === null) {
    await res.body?.cancel();
    return ok ? { ok: true, status, kind: "empty" } : { ok, status, kind: "json", data: null };
  }
  if (contentType.includes("json")) return { ok, status, kind: "json", data: await res.json() };
  if (contentType.startsWith("text/") || !ok) {
    return { ok, status, kind: "text", contentType, text: await res.text() };
  }
  const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { ok: true, status, kind: "binary", contentType, base64 };
}

/**
 * Runs the REST API's operations for agents. Created with the auth instance (Agent Auth's
 * capabilities and executor are fixed when the plugin is), attached to the app once it exists;
 * the operation list is built from the app's OpenAPI document on first use.
 */
export class AgentRuntime {
  /** Agent Auth's capability list: the plugin keeps this array, so it's filled in place. */
  readonly capabilities: Capability[] = [];
  #app: OpenAPIHono<AppEnv> | null = null;
  #operations: Map<string, AgentOperation> | null = null;

  attach(app: OpenAPIHono<AppEnv>) {
    this.#app = app;
  }

  operations(): Map<string, AgentOperation> {
    if (this.#operations) return this.#operations;
    if (!this.#app) throw new Error("AgentRuntime used before the app was attached");
    const doc = buildOpenApiDocument(this.#app) as unknown as OpenApiDocument;
    this.#operations = new Map(agentOperations(doc).map((op) => [op.name, op]));
    this.capabilities.splice(
      0,
      this.capabilities.length,
      ...[...this.#operations.values()].map((op) => ({
        name: op.name,
        description: op.description,
        input: op.inputSchema,
      })),
    );
    return this.#operations;
  }

  /** Fills `capabilities` before Agent Auth reads them. */
  ensureCapabilities() {
    if (this.#app) this.operations();
  }

  /** Runs `name` as the principal's agent: the API's own route, auth, validation and errors. */
  async run(principal: AgentPrincipal, name: string, args: unknown): Promise<OperationResult> {
    const op = this.operations().get(name);
    if (!op || !this.#app) {
      return {
        ok: false,
        status: 404,
        kind: "json",
        data: { error: { code: "UNKNOWN_OPERATION", message: `No operation named ${name}` } },
      };
    }
    if (!op.readOnly && !principal.canWrite) {
      return {
        ok: false,
        status: 403,
        kind: "json",
        data: {
          error: {
            code: "INSUFFICIENT_SCOPE",
            message: "This agent was given read-only access, so it can't make changes",
          },
        },
      };
    }
    if (args !== undefined && !isRecord(args)) return invalid("Arguments must be an object");
    const request = buildRequest(op, args ?? {});
    if (typeof request === "string") return invalid(request);
    const res = await this.#app.fetch(request, { [AGENT_PRINCIPAL]: principal });
    return readResult(res);
  }
}
