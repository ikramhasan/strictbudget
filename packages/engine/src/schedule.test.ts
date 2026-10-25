import { describe, expect, it } from "vitest";
import {
  firstOccurrenceAfter,
  nextOccurrence,
  occurrencesBetween,
  type ScheduleFrequency,
} from "./schedule";

function sequence(frequency: ScheduleFrequency, dateFirst: string, count: number) {
  const dates = [dateFirst];
  while (dates.length < count) {
    const next = nextOccurrence(frequency, dateFirst, dates.at(-1) as string);
    if (!next) break;
    dates.push(next);
  }
  return dates;
}

describe("nextOccurrence", () => {
  it("never repeats a one-off", () => {
    expect(nextOccurrence("never", "2026-10-14", "2026-10-14")).toBeNull();
  });

  it("steps day- and week-based schedules by a fixed number of days", () => {
    expect(sequence("daily", "2026-10-14", 5)).toEqual([
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    expect(sequence("weekly", "2026-10-14", 3)).toEqual(["2026-10-14", "2026-10-21", "2026-10-28"]);
    expect(sequence("everyOtherWeek", "2026-10-14", 3)).toEqual([
      "2026-10-14",
      "2026-10-28",
      "2026-11-11",
    ]);
    expect(sequence("every4Weeks", "2026-10-15", 5)).toEqual([
      "2026-10-15",
      "2026-11-12",
      "2026-12-10",
      "2027-01-07",
      "2027-02-04",
    ]);
  });

  it("counts month-based schedules from the first date, so the 31st comes back", () => {
    expect(sequence("monthly", "2026-10-31", 5)).toEqual([
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
      "2027-01-31",
      "2027-02-28",
    ]);
    expect(sequence("everyOtherMonth", "2026-12-31", 5)).toEqual([
      "2026-12-31",
      "2027-02-28",
      "2027-04-30",
      "2027-06-30",
      "2027-08-31",
    ]);
    expect(sequence("every3Months", "2026-11-30", 5)).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-30",
      "2027-08-30",
      "2027-11-30",
    ]);
    expect(sequence("every4Months", "2026-10-31", 5)).toEqual([
      "2026-10-31",
      "2027-02-28",
      "2027-06-30",
      "2027-10-31",
      "2028-02-29",
    ]);
    expect(sequence("twiceAYear", "2026-12-31", 5)).toEqual([
      "2026-12-31",
      "2027-06-30",
      "2027-12-31",
      "2028-06-30",
      "2028-12-31",
    ]);
    expect(sequence("twiceAYear", "2027-08-31", 4)).toEqual([
      "2027-08-31",
      "2028-02-29",
      "2028-08-31",
      "2029-02-28",
    ]);
  });

  it("steps yearly schedules from the previous date, so Feb 29 drifts", () => {
    expect(sequence("yearly", "2028-02-29", 5)).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-28",
    ]);
    expect(sequence("everyOtherYear", "2028-02-29", 5)).toEqual([
      "2028-02-29",
      "2030-02-28",
      "2032-02-28",
      "2034-02-28",
      "2036-02-28",
    ]);
  });

  it("pairs a day up to the 15th with day + 15 in the same month", () => {
    expect(sequence("twiceAMonth", "2026-10-12", 5)).toEqual([
      "2026-10-12",
      "2026-10-27",
      "2026-11-12",
      "2026-11-27",
      "2026-12-12",
    ]);
    expect(sequence("twiceAMonth", "2026-11-01", 5)).toEqual([
      "2026-11-01",
      "2026-11-16",
      "2026-12-01",
      "2026-12-16",
      "2027-01-01",
    ]);
    expect(sequence("twiceAMonth", "2026-10-15", 5)).toEqual([
      "2026-10-15",
      "2026-10-30",
      "2026-11-15",
      "2026-11-30",
      "2026-12-15",
    ]);
    expect(sequence("twiceAMonth", "2027-02-13", 5)).toEqual([
      "2027-02-13",
      "2027-02-28",
      "2027-03-13",
      "2027-03-28",
      "2027-04-13",
    ]);
  });

  it("pairs a later day with day − 15 in the next month", () => {
    expect(sequence("twiceAMonth", "2026-10-20", 6)).toEqual([
      "2026-10-20",
      "2026-11-05",
      "2026-11-20",
      "2026-12-05",
      "2026-12-20",
      "2027-01-05",
    ]);
    expect(sequence("twiceAMonth", "2026-10-16", 5)).toEqual([
      "2026-10-16",
      "2026-11-01",
      "2026-11-16",
      "2026-12-01",
      "2026-12-16",
    ]);
    expect(sequence("twiceAMonth", "2026-10-29", 5)).toEqual([
      "2026-10-29",
      "2026-11-14",
      "2026-11-29",
      "2026-12-14",
      "2026-12-29",
    ]);
  });

  it("lands the later day on a short month's last day and brings it back", () => {
    expect(sequence("twiceAMonth", "2027-01-31", 5)).toEqual([
      "2027-01-31",
      "2027-02-16",
      "2027-02-28",
      "2027-03-16",
      "2027-03-31",
    ]);
    expect(sequence("twiceAMonth", "2027-01-30", 5)).toEqual([
      "2027-01-30",
      "2027-02-15",
      "2027-02-28",
      "2027-03-15",
      "2027-03-30",
    ]);
    expect(sequence("twiceAMonth", "2027-01-28", 5)).toEqual([
      "2027-01-28",
      "2027-02-13",
      "2027-02-28",
      "2027-03-13",
      "2027-03-28",
    ]);
    expect(sequence("twiceAMonth", "2026-10-31", 5)).toEqual([
      "2026-10-31",
      "2026-11-16",
      "2026-11-30",
      "2026-12-16",
      "2026-12-31",
    ]);
  });
});

describe("firstOccurrenceAfter", () => {
  it("skips the occurrences up to the date (monthly from 9/01 added on 10/11 → 11/01)", () => {
    expect(firstOccurrenceAfter("monthly", "2026-09-01", "2026-10-11")).toBe("2026-11-01");
    expect(firstOccurrenceAfter("weekly", "2026-10-11", "2026-10-11")).toBe("2026-10-18");
  });

  it("keeps a later first date, and ends a past one-off", () => {
    expect(firstOccurrenceAfter("monthly", "2026-12-31", "2026-10-11")).toBe("2026-12-31");
    expect(firstOccurrenceAfter("never", "2026-10-05", "2026-10-11")).toBeNull();
  });
});

describe("occurrencesBetween", () => {
  const weekly = { frequency: "weekly" as const, dateFirst: "2026-10-14", dateNext: "2026-10-14" };

  it("lists the occurrences after a date up to another, from the pending one", () => {
    expect(occurrencesBetween(weekly, "2026-10-12", "2026-10-31")).toEqual([
      "2026-10-14",
      "2026-10-21",
      "2026-10-28",
    ]);
    expect(occurrencesBetween(weekly, "2026-10-31", "2026-11-30")).toHaveLength(4);
  });

  it("stops after a one-off and skips what's not after the start", () => {
    const once = { frequency: "never" as const, dateFirst: "2026-10-20", dateNext: "2026-10-20" };
    expect(occurrencesBetween(once, "2026-10-12", "2026-12-31")).toEqual(["2026-10-20"]);
    expect(occurrencesBetween(once, "2026-10-20", "2026-12-31")).toEqual([]);
    expect(occurrencesBetween(weekly, "2026-10-12", "2026-10-13")).toEqual([]);
  });
});
