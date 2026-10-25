import { describe, expect, it } from "vitest";
import { dateForKey, parseDateInput } from "./dates";

describe("dateForKey", () => {
  const today = "2026-10-18";
  it.each([
    ["+", "2026-10-19"],
    ["-", "2026-10-17"],
    ["ArrowRight", "2026-10-19"],
    ["ArrowLeft", "2026-10-17"],
    ["ArrowDown", "2026-10-25"],
    ["ArrowUp", "2026-10-11"],
    ["m", "2026-10-01"],
    ["M", "2026-10-31"],
    ["y", "2026-01-01"],
    ["Y", "2026-12-31"],
  ])("moves %s from the field's date", (key, expected) => {
    expect(dateForKey("2026-10-18", key, today)).toBe(expected);
  });

  it("goes to today with T, from any date", () => {
    expect(dateForKey("2020-01-15", "t", today)).toBe(today);
    expect(dateForKey("2020-01-15", "T", today)).toBe(today);
  });

  it("crosses month and year ends", () => {
    expect(dateForKey("2026-12-31", "+", today)).toBe("2027-01-01");
    expect(dateForKey("2024-02-10", "M", today)).toBe("2024-02-29");
  });

  it("leaves a dash to the field when the date format uses dashes", () => {
    expect(dateForKey("2026-10-18", "-", today, { dash: false })).toBeNull();
  });

  it("ignores other keys", () => {
    expect(dateForKey("2026-10-18", "1", today)).toBeNull();
    expect(dateForKey("2026-10-18", "/", today)).toBeNull();
  });
});

describe("parseDateInput", () => {
  it("reads the budget's format", () => {
    expect(parseDateInput("10/5/2026", "MM/DD/YYYY")).toBe("2026-10-05");
  });
});
