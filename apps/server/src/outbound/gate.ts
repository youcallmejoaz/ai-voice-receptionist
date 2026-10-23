import type { Lead } from "../crm/leads.js";
import { isSuppressed } from "../crm/suppression.js";
import type { DB } from "../db/index.js";
import type { BusinessProfile } from "../profiles/schema.js";
import { localMinutes } from "../util/time.js";

export type GateResult =
  | { allowed: true }
  | { allowed: false; reason: "no_consent" | "do_not_call" | "invalid_number" | "opted_out" | "outside_calling_hours"; message: string };

/** Calls only between 08:00 and 21:00 local time (TCPA-style quiet hours). */
export const CALLING_WINDOW = { start: 8 * 60, end: 21 * 60 };

/**
 * The single gate every outbound call passes through, checked when the list is run AND again
 * right before dialling. Order matters: the reason logged is the most important one.
 */
export function checkOutbound(db: DB, lead: Lead, profile: BusinessProfile, now: Date): GateResult {
  if (!lead.consent) return { allowed: false, reason: "no_consent", message: "No recorded consent to call" };
  if (!lead.phone) return { allowed: false, reason: "invalid_number", message: "Phone number is missing or invalid" };
  if (isSuppressed(db, lead.phone)) return { allowed: false, reason: "do_not_call", message: "Number is on the do-not-call list" };
  if (lead.status === "opted_out") return { allowed: false, reason: "opted_out", message: "Lead opted out" };
  const m = localMinutes(now, profile.timezone);
  if (m < CALLING_WINDOW.start || m >= CALLING_WINDOW.end) {
    return { allowed: false, reason: "outside_calling_hours", message: "Outside 8am-9pm calling hours" };
  }
  return { allowed: true };
}
