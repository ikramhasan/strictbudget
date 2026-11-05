import { describe, expect, it } from "vitest";
import { dayHeading, shortDate } from "./register-dates";

describe("shortDate", () => {
  it("leaves out this year, keeping the budget's order", () => {
    expect(shortDate("2026-11-05", "MM/DD/YYYY", "2026-11-05")).toBe("11/05");
    expect(shortDate("2026-11-05", "DD/MM/YYYY", "2026-01-01")).toBe("05/11");
    expect(shortDate("2026-11-05", "YYYY-MM-DD", "2026-12-31")).toBe("11-05");
    expect(shortDate("2026-11-05", "DD.MM.YYYY", "2026-11-05")).toBe("05.11");
    expect(shortDate("2026-11-05", "YYYY/MM/DD", "2026-11-05")).toBe("11/05");
    expect(shortDate("2026-11-05", "DD-MM-YYYY", "2026-11-05")).toBe("05-11");
  });

  it("writes another year's date in full", () => {
    expect(shortDate("2025-12-28", "MM/DD/YYYY", "2026-11-05")).toBe("12/28/2025");
    expect(shortDate("2027-01-02", "YYYY-MM-DD", "2026-11-05")).toBe("2027-01-02");
  });
});

describe("dayHeading", () => {
  it("names today and the days either side", () => {
    expect(dayHeading("2026-11-05", "2026-11-05")).toBe("Today");
    expect(dayHeading("2026-11-04", "2026-11-05")).toBe("Yesterday");
    expect(dayHeading("2026-11-06", "2026-11-05")).toBe("Tomorrow");
    expect(dayHeading("2026-01-01", "2026-01-02")).toBe("Yesterday");
  });

  it("gives other days their weekday, and the year when it isn't this one", () => {
    expect(dayHeading("2026-11-01", "2026-11-05", "en-US")).toBe("Sun, Nov 1");
    expect(dayHeading("2025-12-28", "2026-11-05", "en-US")).toBe("Sun, Dec 28, 2025");
  });
});
