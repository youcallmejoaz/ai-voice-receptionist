import type { BusinessProfile } from "../profiles/schema.js";
import { addDays, hhmmToMinutes, localDate, weekdayOf, zonedToUtc } from "../util/time.js";
import type { Slot } from "./adapter.js";

/** Every bookable slot within business hours for `days` days starting today (profile timezone). */
export function generateBusinessSlots(profile: BusinessProfile, now: Date, days: number): Slot[] {
  const out: Slot[] = [];
  const today = localDate(now, profile.timezone);
  const step = profile.booking.slotMinutes;
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const hours = profile.hours[weekdayOf(date)];
    if (!hours) continue;
    const open = hhmmToMinutes(hours.open);
    const close = hhmmToMinutes(hours.close);
    for (let m = open; m + step <= close; m += step) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const start = zonedToUtc(date, `${hh}:${mm}`, profile.timezone);
      out.push({ startUtc: start.toISOString(), endUtc: new Date(start.getTime() + step * 60000).toISOString() });
    }
  }
  return out;
}

/** Earliest bookable moment: now + lead time. */
export function earliestBookable(profile: BusinessProfile, now: Date): Date {
  return new Date(now.getTime() + profile.booking.leadTimeHours * 3600_000);
}
