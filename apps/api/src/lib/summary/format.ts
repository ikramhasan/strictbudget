import type { BudgetMonth } from "@strictbudget/engine";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const monthIndex = (month: BudgetMonth) => Number(month.slice(5, 7)) - 1;

/** "October" for 2026-10. */
export const monthName = (month: BudgetMonth) => MONTHS[monthIndex(month)] as string;

/** "Oct" for 2026-10. */
export const shortMonthName = (month: BudgetMonth) => monthName(month).slice(0, 3);

/** "October 2026" for 2026-10. */
export const monthAndYear = (month: BudgetMonth) => `${monthName(month)} ${month.slice(0, 4)}`;

/** "1 Oct" for 2026-10-01. Unambiguous in every date format, so the budget's isn't needed. */
export const dayAndMonth = (date: string) =>
  `${Number(date.slice(8, 10))} ${shortMonthName(date.slice(0, 7))}`;
