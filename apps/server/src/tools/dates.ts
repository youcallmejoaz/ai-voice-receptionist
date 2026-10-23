import { addDays, isValidDateString, localDate, weekdayOf } from "../util/time.js";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Resolve what the model passes as a date: "2026-10-27", "today", "tomorrow", "tuesday",
 * "next tuesday". Returns YYYY-MM-DD in the business timezone, or null if it cannot be read.
 */
export function resolveDate(input: string, now: Date, timeZone: string): string | null {
  const s = input.trim().toLowerCase();
  const today = localDate(now, timeZone);
  if (isValidDateString(s)) return s;
  if (s === "today") return today;
  if (s === "tomorrow") return addDays(today, 1);
  const m = s.match(/^(?:next |this )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*$/);
  if (m) {
    const target = DAYS.findIndex((d) => d.startsWith(m[1].slice(0, 3)));
    const current = DAYS.findIndex((d) => d.startsWith(weekdayOf(today)));
    let diff = (target - current + 7) % 7;
    if (diff === 0) diff = 7; // "tuesday" said on a tuesday means next week
    return addDays(today, diff);
  }
  return null;
}
