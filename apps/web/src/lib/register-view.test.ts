import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, rangeDates } from "./register-view";

describe("register view", () => {
  it("turns the date presets into whole months", () => {
    const at = (range: (typeof DEFAULT_VIEW)["range"]) =>
      rangeDates({ ...DEFAULT_VIEW, range }, "2026-03-15");
    expect(at("all")).toEqual({});
    expect(at("this_month")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(at("last_month")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(at("latest_3_months")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(at("this_year")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(at("last_year")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(rangeDates({ ...DEFAULT_VIEW, range: "last_month" }, "2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("hides reconciled transactions and the running balance by default", () => {
    expect(DEFAULT_VIEW).toEqual({
      range: "all",
      showReconciled: false,
      showRunningBalance: false,
      showFlags: true,
      showAttachments: true,
      showEnteredBy: false,
      scheduledCollapsed: false,
      sort: [{ column: "date", dir: "desc" }],
    });
  });
});

describe("saved register searches", () => {
  it("remembers each register's search, and forgets a cleared one", async () => {
    const { saveSearch, savedSearch } = await import("./register-view");
    saveSearch("b1", "a1", "Payee: Shop");
    expect(savedSearch("b1", "a1")).toBe("Payee: Shop");
    expect(savedSearch("b1", "all")).toBeUndefined();
    saveSearch("b1", "a1", undefined);
    expect(savedSearch("b1", "a1")).toBeUndefined();
  });
});
