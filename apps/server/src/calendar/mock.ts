import type { DB } from "../db/index.js";
import type { BusinessProfile } from "../profiles/schema.js";
import { getProfile } from "../profiles/store.js";
import { CalendarUnavailableError, SlotTakenError, type BookingDetails, type CalendarAdapter, type Slot } from "./adapter.js";
import { generateBusinessSlots } from "./slots.js";

/**
 * SQLite-backed demo calendar. Slots are generated from business hours for a rolling week, with a
 * deterministic share pre-booked so the calendar looks lived in. The dashboard's "simulate
 * calendar outage" switch makes every call throw CalendarUnavailableError.
 */
export class MockCalendar implements CalendarAdapter {
  readonly name = "mock";
  constructor(private readonly db: DB) {}

  private assertUp(profile: BusinessProfile) {
    if (getProfile(this.db, profile.id)?.calendarOutage) throw new CalendarUnavailableError("Mock calendar outage is switched on");
  }

  /** Make sure the next `days` days have slots. Safe to call repeatedly. */
  ensureSlots(profile: BusinessProfile, now = new Date(), days = 7) {
    const insert = this.db.prepare("INSERT OR IGNORE INTO slots (profile_id, start_utc, end_utc, booked) VALUES (?, ?, ?, ?)");
    const tx = this.db.transaction((slots: Slot[]) => {
      for (const s of slots) {
        // ~30% pre-booked, deterministic per slot so reseeding gives the same picture
        const busy = hash(`${profile.id}${s.startUtc}`) % 10 < 3 ? 1 : 0;
        insert.run(profile.id, s.startUtc, s.endUtc, busy);
      }
    });
    tx(generateBusinessSlots(profile, now, days));
  }

  async listOpenSlots(profile: BusinessProfile, fromUtc: string, toUtc: string): Promise<Slot[]> {
    this.assertUp(profile);
    const rows = this.db
      .prepare(
        "SELECT start_utc, end_utc FROM slots WHERE profile_id = ? AND booked = 0 AND start_utc >= ? AND start_utc < ? ORDER BY start_utc",
      )
      .all(profile.id, fromUtc, toUtc) as { start_utc: string; end_utc: string }[];
    return rows.map((r) => ({ startUtc: r.start_utc, endUtc: r.end_utc }));
  }

  /** Books every base slot covered by [start, end). All must be free or nothing is booked. */
  async book(profile: BusinessProfile, slot: Slot, _details: BookingDetails): Promise<{ ref: string }> {
    this.assertUp(profile);
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT booked FROM slots WHERE profile_id = ? AND start_utc >= ? AND start_utc < ?")
        .all(profile.id, slot.startUtc, slot.endUtc) as { booked: number }[];
      const needed = Math.max(1, Math.round((Date.parse(slot.endUtc) - Date.parse(slot.startUtc)) / (profile.booking.slotMinutes * 60000)));
      if (rows.length !== needed || rows.some((r) => r.booked)) throw new SlotTakenError();
      this.db
        .prepare("UPDATE slots SET booked = 1 WHERE profile_id = ? AND start_utc >= ? AND start_utc < ?")
        .run(profile.id, slot.startUtc, slot.endUtc);
    });
    tx();
    return { ref: `mock-${profile.id}-${slot.startUtc}` };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
