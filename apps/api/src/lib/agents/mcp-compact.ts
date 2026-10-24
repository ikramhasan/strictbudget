import type { AgentOperation } from "./operations";

/**
 * Compact tool mode (`/mcp?tools=compact`): three tools instead of one per operation, for clients
 * that cut or degrade a long tool list (Cursor warns past about 40 tools). The model searches
 * the operations, reads one's input schema, then calls it by name.
 */

const objectSchema = (
  properties: Record<string, Record<string, string | number>>,
  required: string[],
) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

export const COMPACT_TOOLS = [
  {
    name: "searchOperations",
    title: "Search operations",
    description:
      'Find strictbudget operations by keyword (e.g. "create transaction", "budget month", ' +
      '"scheduled"). Returns each match\'s name, summary, HTTP method and path. Without a query, ' +
      "lists every operation's name and summary.",
    inputSchema: objectSchema(
      {
        query: { type: "string", description: "Words to look for in names and descriptions" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 20" },
      },
      [],
    ),
    readOnly: true,
  },
  {
    name: "describeOperation",
    title: "Describe an operation",
    description:
      "An operation's full description and the JSON Schema of its arguments (path and query " +
      "parameters, plus body). Read this before calling an operation you haven't used yet.",
    inputSchema: objectSchema({ name: { type: "string", description: "The operation name" } }, [
      "name",
    ]),
    readOnly: true,
  },
  {
    name: "callOperation",
    title: "Call an operation",
    description:
      "Run an operation by name with its arguments (as described by describeOperation), as the " +
      "signed-in person. Changes made are attributed to this app on their behalf.",
    inputSchema: objectSchema(
      {
        name: { type: "string", description: "The operation name" },
        arguments: {
          type: "object",
          description: "The operation's arguments: path and query parameters, plus body",
        },
      },
      ["name"],
    ),
    readOnly: false,
  },
] as const;

const summary = (op: AgentOperation) => ({
  name: op.name,
  title: op.title,
  method: op.method,
  path: op.path,
  readOnly: op.readOnly,
});

/** Operations matching every word of `query` (name, title, description), best matches first. */
export function searchOperations(ops: AgentOperation[], query: string | undefined, limit = 20) {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const scored = ops.flatMap((op) => {
    const name = op.name.toLowerCase();
    const title = op.title.toLowerCase();
    const text = `${name} ${title} ${op.path.toLowerCase()} ${op.description.toLowerCase()}`;
    let score = 0;
    for (const word of words) {
      if (!text.includes(word)) return [];
      score += (name.includes(word) ? 4 : 0) + (title.includes(word) ? 2 : 0) + 1;
    }
    return [{ op, score }];
  });
  scored.sort((a, b) => b.score - a.score);
  const matches = scored.map((s) => s.op);
  return {
    total: matches.length,
    operations: matches.slice(0, limit).map(summary),
  };
}

export function describeOperation(op: AgentOperation) {
  return {
    ...summary(op),
    destructive: op.destructive,
    description: op.description,
    inputSchema: op.inputSchema,
  };
}
