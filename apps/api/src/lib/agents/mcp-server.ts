import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import { COMPACT_TOOLS, describeOperation, searchOperations } from "./mcp-compact";
import type { AgentOperation } from "./operations";
import type { AgentPrincipal } from "./principal";
import type { AgentRuntime, OperationResult } from "./runtime";

const INSTRUCTIONS =
  "strictbudget is a zero-based budgeting app. Each tool is one operation of its REST " +
  "API, run as the signed-in person (changes are attributed to this app on their behalf). Start " +
  "with listBudgets to find a budgetId; most tools are scoped to one budget. Money amounts are " +
  'integer strings in the currency\'s minor units (e.g. "-1250" is -12.50 USD). Months are ' +
  "YYYY-MM, dates YYYY-MM-DD. To attach a receipt to a transaction, call uploadAttachment with the file " +
  "base64-encoded in body.file. Errors come back as { error: { code, message } }.";

function tool(op: AgentOperation) {
  return {
    name: op.name,
    title: op.title,
    description: op.description,
    inputSchema: op.inputSchema,
    annotations: {
      title: op.title,
      readOnlyHint: op.readOnly,
      destructiveHint: !op.readOnly && op.destructive,
      idempotentHint: op.method === "GET" || op.method === "PUT" || op.method === "DELETE",
      openWorldHint: false,
    },
  };
}

const COMPACT_INSTRUCTIONS =
  "strictbudget is a zero-based budgeting app. Its REST API operations are reached " +
  "through three tools: searchOperations to find an operation, describeOperation for its " +
  "arguments, callOperation to run it by name, as the signed-in person (changes are attributed " +
  "to this app on their behalf). Start with the listBudgets operation to find a budgetId; most " +
  "operations are scoped to one budget. To attach a receipt to a transaction, run the " +
  "uploadAttachment operation with the file base64-encoded in body.file. ";
const COMPACT_FORMATS =
  'Money amounts are integer strings in the currency\'s minor units (e.g. "-1250" is -12.50 USD). ' +
  "Months are YYYY-MM, dates YYYY-MM-DD. Errors come back as { error: { code, message } }.";

const textResult = (data: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  isError,
});
const failure = (code: string, message: string) => textResult({ error: { code, message } }, true);

function toolResult(result: OperationResult) {
  const isError = !result.ok;
  switch (result.kind) {
    case "json":
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data ?? null, null, 2) }],
        isError,
      };
    case "text":
      return { content: [{ type: "text" as const, text: result.text }], isError };
    case "binary":
      return {
        content: [
          result.contentType.startsWith("image/") && result.contentType !== "image/svg+xml"
            ? { type: "image" as const, data: result.base64, mimeType: result.contentType }
            : {
                type: "resource" as const,
                resource: {
                  uri: "strictbudget://download",
                  mimeType: result.contentType,
                  blob: result.base64,
                },
              },
        ],
      };
    case "redirect":
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ url: result.location }) }],
      };
    case "empty":
      return { content: [{ type: "text" as const, text: `Done (HTTP ${result.status}).` }] };
  }
}

/**
 * The MCP server (Streamable HTTP, stateless: a fresh server per request, with the request's
 * verified principal). Every operation agents may run is a tool; with read-only access, only
 * the ones that change nothing are listed. With `compact` (`/mcp?tools=compact`) the tools are
 * three: search, describe and call an operation.
 */
export function createMcpServer(runtime: AgentRuntime, version: string) {
  const build = (principal: AgentPrincipal, compact: boolean) => {
    const server = new Server(
      { name: "strictbudget", title: "strictbudget", version },
      {
        capabilities: { tools: {} },
        instructions: compact ? COMPACT_INSTRUCTIONS + COMPACT_FORMATS : INSTRUCTIONS,
      },
    );
    const visible = () =>
      [...runtime.operations().values()].filter((op) => principal.canWrite || op.readOnly);
    if (!compact) {
      server.setRequestHandler("tools/list", async () => ({ tools: visible().map(tool) }));
      server.setRequestHandler("tools/call", async (request) => {
        const { name, arguments: args } = request.params;
        return toolResult(await runtime.run(principal, name, args ?? {}));
      });
      return server;
    }
    server.setRequestHandler("tools/list", async () => ({
      tools: COMPACT_TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: {
          title: t.title,
          readOnlyHint: t.readOnly,
          destructiveHint: !t.readOnly,
          openWorldHint: false,
        },
      })),
    }));
    server.setRequestHandler("tools/call", async (request) => {
      const { name, arguments: raw } = request.params;
      const args = raw ?? {};
      switch (name) {
        case "searchOperations": {
          const { query, limit } = args;
          if (query !== undefined && typeof query !== "string")
            return failure("INVALID_ARGUMENTS", '"query" must be a string');
          if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1))
            return failure("INVALID_ARGUMENTS", '"limit" must be a positive integer');
          return textResult(
            searchOperations(visible(), query, Math.min((limit as number | undefined) ?? 20, 100)),
          );
        }
        case "describeOperation": {
          const op = visible().find((o) => o.name === args.name);
          if (!op) return failure("UNKNOWN_OPERATION", `No operation named ${String(args.name)}`);
          return textResult(describeOperation(op));
        }
        case "callOperation": {
          if (typeof args.name !== "string") {
            return failure("INVALID_ARGUMENTS", '"name" is required');
          }
          return toolResult(await runtime.run(principal, args.name, args.arguments));
        }
        default:
          return failure("UNKNOWN_TOOL", `No tool named ${name}`);
      }
    });
    return server;
  };
  return createMcpHandler(
    (ctx) => {
      const principal = ctx.authInfo?.extra?.principal as AgentPrincipal | undefined;
      if (!principal) throw new Error("MCP request without a verified principal");
      return build(principal, ctx.authInfo?.extra?.compact === true);
    },
    // Today's clients (Claude Code, Cursor) speak the 2025 protocol versions.
    { legacy: "stateless" },
  );
}
