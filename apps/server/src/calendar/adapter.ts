import type { BusinessProfile } from "../profiles/schema.js";

export interface Slot {
  startUtc: string;
  endUtc: string;
}

export interface BookingDetails {
  name: string;
  phone: string;
  email?: string;
  service: string;
  notes?: string;
}

export interface CalendarEvent extends Slot {
  ref: string;
  title: string;
}

/** Raised when the calendar backend is down or unreachable. Tools turn this into a callback offer. */
export class CalendarUnavailableError extends Error {
  constructor(message = "Calendar unavailable") {
    super(message);
    this.name = "CalendarUnavailableError";
  }
}

/** Raised when the requested slot is no longer free. */
export class SlotTakenError extends Error {
  constructor() {
    super("Slot is no longer available");
    this.name = "SlotTakenError";
  }
}

export interface CalendarAdapter {
  readonly name: string;
  /** Open slots between from and to (UTC ISO), already filtered to business hours. */
  listOpenSlots(profile: BusinessProfile, fromUtc: string, toUtc: string): Promise<Slot[]>;
  /** Book a slot that was returned by listOpenSlots. Returns an external reference. */
  book(profile: BusinessProfile, slot: Slot, details: BookingDetails): Promise<{ ref: string }>;
}
