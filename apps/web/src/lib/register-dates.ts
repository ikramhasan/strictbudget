import { type DateFormat, formatDate } from "@strictbudget/engine";

/**
 * A register's date: without its year when it's in `today`'s year ("11/05", "05.11", "11-05"),
 * in the budget's order; in full otherwise. The date fields read the short form back as this year.
 */
export function shortDate(iso: string, format: DateFormat, today: string): string {
  if (iso.slice(0, 4) !== today.slice(0, 4)) return formatDate(iso, format);
  const [, mm = "", dd = ""] = iso.split("-");
  return format
    .replace(/^YYYY\W|\WYYYY$/, "")
    .replace("MM", mm)
    .replace("DD", dd);
}

/**
 * A phone register's day heading: "Today", "Yesterday", "Tomorrow", or the weekday and date in the
 * reader's language ("Mon, Nov 3"), with the year when it isn't this one.
 */
export function dayHeading(iso: string, today: string, locale?: string): string {
  const offset = Math.round((utc(iso) - utc(today)) / 86_400_000);
  if (offset === 0) return "Today";
  if (offset === -1) return "Yesterday";
  if (offset === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(iso.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(utc(iso));
}

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
