import { addDays, addMonths, addYears, format, getDaysInMonth, parseISO } from "date-fns";
import { z } from "zod";

/** How often a scheduled transaction repeats, in display order. "never" is a one-off. */
export const SCHEDULE_FREQUENCIES = [
  "never",
  "daily",
  "weekly",
  "everyOtherWeek",
  "twiceAMonth",
  "every4Weeks",
  "monthly",
  "everyOtherMonth",
  "every3Months",
  "every4Months",
  "twiceAYear",
  "yearly",
  "everyOtherYear",
] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const zScheduleFrequency = z.enum(SCHEDULE_FREQUENCIES);

export const SCHEDULE_FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  never: "Never",
  daily: "Daily",
  weekly: "Weekly",
  everyOtherWeek: "Every other week",
  twiceAMonth: "Twice a month",
  every4Weeks: "Every 4 weeks",
  monthly: "Monthly",
  everyOtherMonth: "Every other month",
  every3Months: "Every 3 months",
  every4Months: "Every 4 months",
  twiceAYear: "Twice a year",
  yearly: "Yearly",
  everyOtherYear: "Every other year",
};

const DAY_STEPS: Partial<Record<ScheduleFrequency, number>> = {
  daily: 1,
  weekly: 7,
  everyOtherWeek: 14,
  every4Weeks: 28,
};

const MONTH_STEPS: Partial<Record<ScheduleFrequency, number>> = {
  monthly: 1,
  everyOtherMonth: 2,
  every3Months: 3,
  every4Months: 4,
  twiceAYear: 6,
};

const YEAR_STEPS: Partial<Record<ScheduleFrequency, number>> = {
  yearly: 1,
  everyOtherYear: 2,
};

// Calendar dates only: parsed and formatted in local time, so no time zone ever shifts a day.
const toDate = (iso: string) => parseISO(iso);
const toIso = (date: Date) => format(date, "yyyy-MM-dd");

/** The month `count` months after `date`'s, on `day` or the month's last day if shorter. */
function onDay(date: Date, count: number, day: number) {
  const first = addMonths(new Date(date.getFullYear(), date.getMonth(), 1), count);
  return new Date(first.getFullYear(), first.getMonth(), Math.min(day, getDaysInMonth(first)));
}

/**
 * The occurrence after `current` of a schedule that started on `dateFirst`, or null for a one-off
 * ("never"). `current` is one of its occurrences (editing the date restarts the schedule there).
 *
 * - daily and the week-based ones step by a fixed number of days;
 * - month-based ones (monthly to twice a year) count from `dateFirst` and fall on its day, or the
 *   month's last day when shorter, so the 31st comes back after February (10/31 → 11/30 → 12/31);
 * - yearly and every other year step from the previous date, so Feb 29 drifts to the 28th for
 *   good (2028-02-29 → 2029-02-28 → … → 2032-02-28);
 * - twice a month pairs `dateFirst`'s day with the day 15 later: a day up to the 15th with day + 15
 *   in the same month (14th → 29th), a later one with day − 15 in the next month (20th → 5th,
 *   31st → 16th). The later day falls on the month's last day when shorter, and comes back.
 */
export function nextOccurrence(
  frequency: ScheduleFrequency,
  dateFirst: string,
  current: string,
): string | null {
  if (frequency === "never") return null;
  const after = toDate(current);
  const days = DAY_STEPS[frequency];
  if (days !== undefined) return toIso(addDays(after, days));
  const years = YEAR_STEPS[frequency];
  if (years !== undefined) return toIso(addYears(after, years));

  const first = toDate(dateFirst);
  const day = first.getDate();
  const monthsSince =
    (after.getFullYear() - first.getFullYear()) * 12 + after.getMonth() - first.getMonth();
  const months = MONTH_STEPS[frequency];
  if (months !== undefined) {
    for (let n = Math.max(0, Math.floor(monthsSince / months)); ; n++) {
      const candidate = onDay(first, n * months, day);
      if (candidate > after) return toIso(candidate);
    }
  }

  // Twice a month: the month's two days, from `current`'s month on.
  const [early, late] = day <= 15 ? [day, day + 15] : [day - 15, day];
  for (let n = monthsSince; ; n++) {
    for (const d of [early, late]) {
      const candidate = onDay(first, n, d);
      if (candidate > after && candidate >= first) return toIso(candidate);
    }
  }
}

/** The schedule's first occurrence after `date` (null when a one-off is already past it). */
export function firstOccurrenceAfter(
  frequency: ScheduleFrequency,
  dateFirst: string,
  date: string,
): string | null {
  let next: string | null = dateFirst;
  while (next !== null && next <= date) next = nextOccurrence(frequency, dateFirst, next);
  return next;
}

/**
 * The schedule's occurrences dated after `after` and up to `until` (both YYYY-MM-DD), in order,
 * starting from its pending `dateNext`: a category's upcoming transactions.

 */
export function occurrencesBetween(
  schedule: { frequency: ScheduleFrequency; dateFirst: string; dateNext: string },
  after: string,
  until: string,
): string[] {
  const dates: string[] = [];
  let date: string | null = schedule.dateNext;
  while (date !== null && date <= until) {
    if (date > after) dates.push(date);
    date = nextOccurrence(schedule.frequency, schedule.dateFirst, date);
  }
  return dates;
}
