import { describe, expect, it } from "vitest";
import { currentMonth, lastViewedMonth, rememberMonth } from "./months";

describe("lastViewedMonth", () => {
  it("reopens the budget screen on the month last shown, per budget", () => {
    expect(lastViewedMonth("b1")).toBeUndefined();
    rememberMonth("b1", "2020-03");
    expect(lastViewedMonth("b1")).toBe("2020-03");
    expect(lastViewedMonth("b2")).toBeUndefined();
    rememberMonth("b1", currentMonth());
    expect(lastViewedMonth("b1")).toBeUndefined();
  });
});
