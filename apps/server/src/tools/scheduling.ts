import { z } from "zod";
import { CalendarUnavailableError, SlotTakenError, type Slot } from "../calendar/adapter.js";
import { earliestBookable } from "../calendar/slots.js";
import { setCallLead } from "../calls.js";
import { upsertLead } from "../crm/leads.js";
import { logEvent } from "../db/index.js";
import type { BusinessProfile } from "../profiles/schema.js";
import { toE164 } from "../util/phone.js";
import { addDays, localDate, localMinutes, spokenDateTime, zonedToUtc } from "../util/time.js";
import type { ToolContext, ToolResult } from "./context.js";
import { resolveDate } from "./dates.js";

const CALENDAR_DOWN: ToolResult = {
  ok: false,
  error: "calendar_unavailable",
  fallback: "take_callback",
  say: "Apologise that the booking system isn't responding right now, then offer to take their name, number and a preferred time so the team can call back and confirm. Use request_callback once they agree.",
};

function service(profile: BusinessProfile, id: string | undefined) {
  return profile.services.find((s) => s.id === id) ?? profile.services[0];
}

/** Start times from which `durationMin` of consecutive open base slots are free. */
export function startsThatFit(open: Slot[], durationMin: number, slotMinutes: number): Slot[] {
  const needed = Math.max(1, Math.ceil(durationMin / slotMinutes));
  const starts = new Set(open.map((s) => s.startUtc));
  return open
    .filter((s) => {
      for (let i = 1; i < needed; i++) {
        if (!starts.has(new Date(Date.parse(s.startUtc) + i * slotMinutes * 60000).toISOString())) return false;
      }
      return true;
    })
    .map((s) => ({ startUtc: s.startUtc, endUtc: new Date(Date.parse(s.startUtc) + durationMin * 60000).toISOString() }));
}

/** Up to n options, at least 90 minutes apart, so the caller hears a real choice. */
function spread(slots: Slot[], n: number): Slot[] {
  const out: Slot[] = [];
  for (const s of slots) {
    if (out.length === n) break;
    if (!out.length || Date.parse(s.startUtc) - Date.parse(out[out.length - 1].startUtc) >= 90 * 60000) out.push(s);
  }
  return out;
}

async function openStarts(ctx: ToolContext, fromUtc: string, toUtc: string, durationMin: number) {
  const earliest = earliestBookable(ctx.profile, ctx.now()).toISOString();
  const from = fromUtc > earliest ? fromUtc : earliest;
  const open = await ctx.calendar.listOpenSlots(ctx.profile, from, toUtc);
  return startsThatFit(open, durationMin, ctx.profile.booking.slotMinutes);
}

function dayRange(profile: BusinessProfile, date: string) {
  return {
    from: zonedToUtc(date, "00:00", profile.timezone).toISOString(),
    to: zonedToUtc(addDays(date, 1), "00:00", profile.timezone).toISOString(),
  };
}

// ---------------------------------------------------------------- check_availability

export const checkAvailabilityArgs = z.object({
  date: z
    .string()
    .optional()
    .describe('Day the caller wants: YYYY-MM-DD, "today", "tomorrow" or a weekday like "tuesday". Omit for the next available.'),
  part_of_day: z.enum(["morning", "afternoon", "any"]).optional().describe("Morning is before noon."),
  service_id: z.string().optional().describe("Service id from the profile; sets the appointment length."),
});

export async function checkAvailability(ctx: ToolContext, args: z.infer<typeof checkAvailabilityArgs>): Promise<ToolResult> {
  const { profile } = ctx;
  const svc = service(profile, args.service_id);
  const today = localDate(ctx.now(), profile.timezone);
  let from: string;
  let to: string;
  let date: string | null = null;
  if (args.date) {
    date = resolveDate(args.date, ctx.now(), profile.timezone);
    if (!date) {
      return {
        ok: false,
        error: "invalid_date",
        today,
        say: "You couldn't read that date. Ask the caller once more which day suits them, for example 'this Thursday'.",
      };
    }
    const last = addDays(today, profile.booking.maxDaysAhead);
    if (date < today || date > last) {
      return {
        ok: false,
        error: "date_out_of_range",
        today,
        say: `Explain you can book from today up to ${profile.booking.maxDaysAhead} days ahead and ask for another day.`,
      };
    }
    ({ from, to } = dayRange(profile, date));
  } else {
    from = ctx.now().toISOString();
    to = dayRange(profile, addDays(today, profile.booking.maxDaysAhead)).to;
  }

  let starts: Slot[];
  try {
    starts = await openStarts(ctx, from, to, svc.durationMin);
  } catch (e) {
    if (e instanceof CalendarUnavailableError) {
      logEvent(ctx.db, { callId: ctx.call?.id, profileId: profile.id, kind: "tool", name: "calendar_failure", detail: { tool: "check_availability" } });
      return CALENDAR_DOWN;
    }
    throw e;
  }
  if (args.part_of_day && args.part_of_day !== "any") {
    const morning = args.part_of_day === "morning";
    starts = starts.filter((s) => (localMinutes(new Date(s.startUtc), profile.timezone) < 12 * 60) === morning);
  }

  if (!starts.length) {
    // suggest the next day that has something
    const next = await openStarts(ctx, to, dayRange(profile, addDays(today, profile.booking.maxDaysAhead)).to, svc.durationMin).catch(
      () => [],
    );
    return {
      ok: true,
      options: [],
      service: svc.name,
      say: next.length
        ? `Nothing open then. The next opening is ${spokenDateTime(next[0].startUtc, profile.timezone)}. Offer it.`
        : "There are no openings in the booking window. Offer to take a callback request.",
      next_available: next[0] ? { slot_start: next[0].startUtc, spoken: spokenDateTime(next[0].startUtc, profile.timezone) } : null,
    };
  }
  const options = spread(starts, 3).map((s) => ({ slot_start: s.startUtc, spoken: spokenDateTime(s.startUtc, profile.timezone) }));
  return {
    ok: true,
    service: svc.name,
    duration_min: svc.durationMin,
    options,
    say: "Offer these times (at most two at once). When the caller picks one, collect name and phone, then call book_appointment with that slot_start.",
  };
}

// ---------------------------------------------------------------- book_appointment

export const bookAppointmentArgs = z.object({
  slot_start: z.string().describe("slot_start exactly as returned by check_availability"),
  name: z.string().min(1).describe("Caller's full name"),
  phone: z.string().describe("Caller's phone number"),
  email: z.string().optional(),
  service_id: z.string().optional(),
  notes: z.string().optional().describe("Anything the team should know before the visit"),
});

export async function bookAppointment(ctx: ToolContext, args: z.infer<typeof bookAppointmentArgs>): Promise<ToolResult> {
  const { profile, db } = ctx;
  const phone = toE164(args.phone) ?? toE164(ctx.customerPhone);
  if (!phone) {
    return { ok: false, error: "invalid_phone", say: "That phone number didn't look complete. Ask the caller to repeat it slowly, digit by digit." };
  }
  if (args.service_id && !profile.services.some((s) => s.id === args.service_id)) {
    return { ok: false, error: "unknown_service", valid_service_ids: profile.services.map((s) => s.id) };
  }
  const startMs = Date.parse(args.slot_start);
  if (Number.isNaN(startMs)) {
    return { ok: false, error: "invalid_slot", say: "Run check_availability again and use one of the slot_start values it returns." };
  }
  const svc = service(profile, args.service_id);
  const slot: Slot = { startUtc: new Date(startMs).toISOString(), endUtc: new Date(startMs + svc.durationMin * 60000).toISOString() };

  try {
    const fits = await openStarts(ctx, slot.startUtc, new Date(startMs + 1).toISOString(), svc.durationMin);
    if (!fits.length) throw new SlotTakenError();
    const { ref } = await ctx.calendar.book(profile, slot, { name: args.name, phone, email: args.email, service: svc.name, notes: args.notes });

    const lead = upsertLead(
      db,
      { profileId: profile.id, name: args.name, phone, email: args.email, interest: svc.name, source: sourceOf(ctx), status: "booked" },
      ctx.call?.lead_id,
    );
    if (ctx.call) setCallLead(db, ctx.call.id, lead.id);
    db.prepare(
      "INSERT INTO appointments (profile_id, lead_id, call_id, service, start_utc, end_utc, calendar_ref) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(profile.id, lead.id, ctx.call?.id ?? null, svc.name, slot.startUtc, slot.endUtc, ref);
    logEvent(db, { callId: ctx.call?.id, profileId: profile.id, kind: "tool", name: "booked", detail: { leadId: lead.id, start: slot.startUtc, service: svc.name } });
    await ctx.crm.pushLead(lead, { profileName: profile.name, event: "appointment_booked" });
    return {
      ok: true,
      confirmation: { when: spokenDateTime(slot.startUtc, profile.timezone), service: svc.name, address: profile.address },
      say: "Confirm the day, time and service back to the caller, mention the address, and ask if there's anything else.",
    };
  } catch (e) {
    if (e instanceof CalendarUnavailableError) {
      logEvent(db, { callId: ctx.call?.id, profileId: profile.id, kind: "tool", name: "calendar_failure", detail: { tool: "book_appointment" } });
      return CALENDAR_DOWN;
    }
    if (e instanceof SlotTakenError) {
      const date = localDate(new Date(startMs), profile.timezone);
      const alt = await checkAvailability(ctx, { date, service_id: svc.id });
      return { ok: false, error: "slot_unavailable", alternatives: alt.options ?? [], say: "That time was just taken. Apologise and offer the alternatives." };
    }
    throw e;
  }
}

// ---------------------------------------------------------------- request_callback

export const requestCallbackArgs = z.object({
  name: z.string().min(1),
  phone: z.string(),
  preferred_time: z.string().optional().describe("When they'd like the call back, in their words"),
  reason: z.string().describe("What the callback is about"),
});

export async function requestCallback(ctx: ToolContext, args: z.infer<typeof requestCallbackArgs>): Promise<ToolResult> {
  const phone = toE164(args.phone) ?? toE164(ctx.customerPhone);
  if (!phone) return { ok: false, error: "invalid_phone", say: "Ask the caller to repeat their phone number digit by digit." };
  const lead = upsertLead(
    ctx.db,
    {
      profileId: ctx.profile.id,
      name: args.name,
      phone,
      interest: args.reason,
      qualification: args.preferred_time ? { callback_time: args.preferred_time } : {},
      source: sourceOf(ctx),
      status: "callback_requested",
    },
    ctx.call?.lead_id,
  );
  if (ctx.call) setCallLead(ctx.db, ctx.call.id, lead.id);
  logEvent(ctx.db, { callId: ctx.call?.id, profileId: ctx.profile.id, kind: "tool", name: "callback_requested", detail: { leadId: lead.id, preferred: args.preferred_time } });
  await ctx.crm.pushLead(lead, { profileName: ctx.profile.name, event: "callback_requested" });
  return { ok: true, say: "Confirm the team will call them back (mention the preferred time if given) and thank them." };
}

export function sourceOf(ctx: ToolContext) {
  return ctx.call?.direction === "outbound" ? "outbound_call" : "inbound_call";
}
