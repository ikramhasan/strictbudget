import { describe, expect, it } from "vitest";
import { historyRange } from "./category-history-panel";

describe("the inspector's history range", () => {
  it("writes the months the chart shows one way, whichever month is inspected", () => {
    expect(historyRange({ from: "2025-12", to: "2026-11" })).toBe("Dec 2025 – Nov 2026");
    expect(historyRange({ from: "2026-09", to: "2026-11" })).toBe("Sep – Nov 2026");
    expect(historyRange({ from: "2026-09", to: "2026-10" })).toBe("Sep – Oct 2026");
    expect(historyRange({ from: "2026-11", to: "2026-11" })).toBe("Nov 2026");
  });
});
