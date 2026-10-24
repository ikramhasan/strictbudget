import { describe, expect, it } from "vitest";
import { agentSetupPrompt } from "./agents";

describe("agentSetupPrompt", () => {
  it("names the MCP server, how to add it and a first check, for this server", () => {
    const prompt = agentSetupPrompt("https://budget.example");
    expect(prompt).toContain(
      "claude mcp add --transport http strictbudget https://budget.example/mcp",
    );
    expect(prompt).toContain("listBudgets");
    expect(prompt).toContain("https://budget.example/.well-known/agent-configuration");
  });
});
