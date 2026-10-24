/**
 * What agents can do: every operation of the REST API (from its OpenAPI document) except the few
 * that only the person themself may do. MCP tools and Agent Auth capabilities are both built from
 * this list, and both run an operation the same way: as a request to the API itself
 * (`dispatch.ts`), so they get the same validation, permissions and error shapes as the web app.
 */

type Json = Record<string, unknown>;

/**
 * Left out for agents: account security (email, password, sessions, two-step verification,
 * deleting the account, API keys), managing agents themselves, the live event stream (agents can't hold
 * it open through a tool call), the web app's own error reports, and the in-app AI assistant.
 */
const AGENT_EXCLUDED = new Set([
  "getHealth",
  "reportClientError",
  "changeEmail",
  "listSessions",
  "revokeOtherSessions",
  "revokeSession",
  "disableTwoFactor",
  "deleteMyAccount",
  // The token in an email is the authorization; an agent has no business with it.
  "unsubscribeEmail",
  "listApiKeys",
  "createApiKey",
  "deleteApiKey",
  "streamBudgetEvents",
  "listConnectedAgents",
  "revokeConnectedAgent",
  "getAgentApproval",
  // strictbudget's own AI assistant: an agent driving it would spend the server's model key, approve
  // its changes itself and have them recorded as "strictbudget AI" instead of as itself.
  "getAiSettings",
  "updateAiSettings",
  "listAiConversations",
  "deleteAiConversation",
  "aiChat",
  "hydrateAiChat",
  "uploadAiAttachment",
  "getAiAttachment",
  "deleteAiAttachment",
  "draftTransactionFromFile",
]);

/** POSTs that only read (a viewer may make them too): allowed with read access alone. */
const READ_ONLY_POSTS = new Set([
  "summarizeSelection",
  "previewReconcileAccount",
  "exportSelectedTransactions",
  "listExternalPlans",
  "viewInvitation",
]);

export interface FileArgument {
  fileName: string;
  base64: string;
  /** The MIME type; the server reads the real type from the bytes either way. */
  contentType?: string;
}

export interface AgentOperation {
  /** The OpenAPI operationId: the MCP tool name and the Agent Auth capability name. */
  name: string;
  method: string;
  path: string;
  title: string;
  description: string;
  /** Changes nothing: allowed with read access alone. */
  readOnly: boolean;
  destructive: boolean;
  /** JSON Schema of the arguments: path and query parameters, plus `body`. */
  inputSchema: Json & { type: "object" };
  pathParams: string[];
  queryParams: string[];
  /** How `body` is sent: JSON, or multipart with base64 file fields. */
  body: { kind: "json" } | { kind: "multipart"; fileFields: string[] } | null;
}

interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Json;
}
interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Json }> };
}
export interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, Json> };
}

const REF_PREFIX = "#/components/schemas/";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** `schema` with component refs pointing at `$defs`, and the names it (transitively) needs. */
function inlineRefs(schema: unknown, components: Record<string, Json>, defs: Map<string, unknown>) {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== "object") return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith(REF_PREFIX)) {
        const name = value.slice(REF_PREFIX.length);
        if (!defs.has(name)) {
          defs.set(name, null);
          defs.set(name, visit(components[name] ?? {}));
        }
        out.$ref = `#/$defs/${name}`;
      } else {
        out[key] = visit(value);
      }
    }
    return out;
  };
  return visit(schema);
}

const FILE_ARGUMENT_SCHEMA = {
  type: "object",
  description: "A file to upload, base64-encoded",
  properties: {
    fileName: { type: "string", minLength: 1, description: 'The file name, e.g. "receipt.jpg"' },
    base64: { type: "string", minLength: 1, description: "The file's bytes, base64-encoded" },
    contentType: {
      type: "string",
      description: "The MIME type (optional; the server reads the type from the bytes)",
    },
  },
  required: ["fileName", "base64"],
  additionalProperties: false,
} as const;

function operationFrom(
  method: string,
  path: string,
  op: OpenApiOperation,
  components: Record<string, Json>,
): AgentOperation | null {
  const name = op.operationId;
  if (!name || AGENT_EXCLUDED.has(name)) return null;
  const defs = new Map<string, unknown>();
  const properties: Json = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  for (const p of op.parameters ?? []) {
    if (p.in !== "path" && p.in !== "query") continue;
    (p.in === "path" ? pathParams : queryParams).push(p.name);
    const schema = inlineRefs(p.schema ?? { type: "string" }, components, defs) as Json;
    properties[p.name] =
      p.description && !schema.description ? { ...schema, description: p.description } : schema;
    if (p.required || p.in === "path") required.push(p.name);
  }

  let body: AgentOperation["body"] = null;
  const content = op.requestBody?.content ?? {};
  if (content["application/json"]) {
    body = { kind: "json" };
    properties.body = inlineRefs(content["application/json"].schema ?? {}, components, defs);
  } else if (content["multipart/form-data"]) {
    const schema = (content["multipart/form-data"].schema ?? {}) as {
      properties?: Record<string, Json>;
      required?: string[];
    };
    const fileFields: string[] = [];
    const fields: Json = {};
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      if (fieldSchema.format === "binary") {
        fileFields.push(field);
        fields[field] = FILE_ARGUMENT_SCHEMA;
      } else {
        fields[field] = inlineRefs(fieldSchema, components, defs);
      }
    }
    body = { kind: "multipart", fileFields };
    properties.body = {
      type: "object",
      properties: fields,
      required: schema.required ?? [],
      additionalProperties: false,
    };
  }
  if (body && op.requestBody?.required) required.push("body");

  const inputSchema: AgentOperation["inputSchema"] = {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
  if (defs.size > 0) inputSchema.$defs = Object.fromEntries(defs);

  const upper = method.toUpperCase();
  const title = op.summary ?? name;
  return {
    name,
    method: upper,
    path,
    title,
    description: [op.summary, op.description].filter(Boolean).join("\n\n") || name,
    readOnly: upper === "GET" || READ_ONLY_POSTS.has(name),
    destructive: upper === "DELETE" || /^(delete|remove|revoke|cancel|leave)/.test(name),
    inputSchema,
    pathParams,
    queryParams,
    body,
  };
}

export function agentOperations(doc: OpenApiDocument): AgentOperation[] {
  const components = doc.components?.schemas ?? {};
  const ops: AgentOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const built = operationFrom(method, path, op, components);
      if (built) ops.push(built);
    }
  }
  return ops;
}
