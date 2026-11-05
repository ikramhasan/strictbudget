import { describe, expect, it } from "vitest";
import { describeError } from "./error-screen";

describe("describeError", () => {
  it("says the server can't be reached when a request fails or returns nothing", () => {
    expect(describeError(new TypeError("Failed to fetch")).title).toBe(
      "We can't reach strictbudget",
    );
    expect(describeError(new Error('["get","/v1/instance"] data is undefined')).kind).toBe(
      "unreachable",
    );
    expect(describeError({ status: 503 }).kind).toBe("unreachable");
  });

  it("says the browser is offline before anything else", () => {
    expect(describeError(new TypeError("Failed to fetch"), false).title).toBe("You're offline");
  });

  it("keeps an unexpected error's message and stack for the details", () => {
    const error = new Error("boom");
    const described = describeError(error);
    expect(described.title).toBe("Something went wrong");
    expect(described.details).toMatch(/^Error: boom\n\s+at /);
    expect(describeError({ error: { code: "X" } }).details).toContain('"code": "X"');
  });
});
