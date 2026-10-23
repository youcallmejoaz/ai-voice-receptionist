import { beforeEach, describe, expect, it } from "vitest";
import { isSuppressed } from "../src/crm/suppression.js";
import { setCalendarOutage } from "../src/profiles/store.js";
import { localMinutes } from "../src/util/time.js";
import { makeTestApp, SECRET, tool } from "./helpers.js";

const DENTAL = "bright-smile-dental";
const ROOF = "summit-roofing";

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeEach(async () => {
  t = await makeTestApp();
});

describe("tool endpoint auth", () => {
  it("rejects calls without the webhook secret", async () => {
    const res = await t.http.post("/api/vapi/tools/check_availability").send({ profileId: DENTAL, args: {} });
    expect(res.status).toBe(401);
    const wrong = await t.http.post("/api/vapi/webhook").set("x-vapi-secret", "nope").send({});
    expect(wrong.status).toBe(401);
  });

  it("returns recoverable errors for unknown tools and bad arguments", async () => {
    expect((await tool(t.http, DENTAL, "launch_rocket", {})).result.error).toBe("unknown_tool");
    const bad = await tool(t.http, DENTAL, "book_appointment", { slot_start: "x" });
    expect(bad.result).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect(bad.result.issues.join(" ")).toMatch(/name/);
  });
});

describe("check_availability", () => {
  it("offers up to three times inside opening hours and after the lead time", async () => {
    const { result } = await tool(t.http, DENTAL, "check_availability", { service_id: "cleaning" });
    expect(result.ok).toBe(true);
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options.length).toBeLessThanOrEqual(3);
    for (const o of result.options) {
      expect(Date.parse(o.slot_start)).toBeGreaterThanOrEqual(t.ctx.now().getTime() + 2 * 3600_000);
      const m = localMinutes(new Date(o.slot_start), "America/Chicago");
      expect(m).toBeGreaterThanOrEqual(8 * 60);
      expect(o.spoken).toMatch(/day, \w+ \d+ at \d+:\d\d (AM|PM)/);
    }
  });

  it("understands a weekday and part of day", async () => {
    const { result } = await tool(t.http, DENTAL, "check_availability", { date: "thursday", part_of_day: "afternoon" });
    expect(result.ok).toBe(true);
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) {
      expect(o.spoken).toMatch(/^Thursday, October 29/);
      expect(o.spoken).toMatch(/PM$/);
    }
  });

  it("asks again on an unreadable date and refuses dates outside the window", async () => {
    const bad = await tool(t.http, DENTAL, "check_availability", { date: "the day after the thing" });
    expect(bad.result).toMatchObject({ ok: false, error: "invalid_date", today: "2026-10-26" });
    const far = await tool(t.http, DENTAL, "check_availability", { date: "2027-03-01" });
    expect(far.result.error).toBe("date_out_of_range");
  });

  it("falls back to a callback request when the calendar is down", async () => {
    setCalendarOutage(t.ctx.db, DENTAL, true);
    const { result } = await tool(t.http, DENTAL, "check_availability", {});
    expect(result).toMatchObject({ ok: false, error: "calendar_unavailable", fallback: "take_callback" });
    expect(result.say).toMatch(/request_callback/);
  });

  it("never offers a 60 minute service where only 30 minutes are free", async () => {
    const { result } = await tool(t.http, DENTAL, "check_availability", { service_id: "new-patient-exam" });
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) {
      const start = o.slot_start as string;
      const second = new Date(Date.parse(start) + 30 * 60000).toISOString();
      const rows = t.ctx.db.prepare("SELECT booked FROM slots WHERE profile_id = ? AND start_utc IN (?, ?)").all(DENTAL, start, second) as { booked: number }[];
      expect(rows).toEqual([{ booked: 0 }, { booked: 0 }]);
    }
  });
});

describe("book_appointment", () => {
  async function firstSlot(profile = DENTAL, service_id = "cleaning") {
    return (await tool(t.http, profile, "check_availability", { service_id })).result.options[0].slot_start as string;
  }

  it("books the slot, records the appointment and puts the lead in the CRM", async () => {
    const slot = await firstSlot();
    const { result, sessionId } = await tool(t.http, DENTAL, "book_appointment", {
      slot_start: slot,
      name: "Jordan Avery",
      phone: "(312) 555-0144",
      service_id: "cleaning",
    });
    expect(result.ok).toBe(true);
    expect(result.confirmation.address).toContain("Maple Avenue");
    const appt = t.ctx.db.prepare("SELECT * FROM appointments").get() as any;
    expect(appt.start_utc).toBe(slot);
    const lead = t.ctx.db.prepare("SELECT * FROM leads WHERE id = ?").get(appt.lead_id) as any;
    expect(lead).toMatchObject({ name: "Jordan Avery", phone_e164: "+13125550144", status: "booked" });
    expect(lead.crm_pushed_at).not.toBeNull();
    const call = t.ctx.db.prepare("SELECT lead_id FROM calls WHERE session_id = ?").get(sessionId) as any;
    expect(call.lead_id).toBe(lead.id);
  });

  it("blocks double booking and offers alternatives", async () => {
    const slot = await firstSlot();
    const args = { slot_start: slot, name: "A", phone: "3125550144", service_id: "cleaning" };
    expect((await tool(t.http, DENTAL, "book_appointment", args)).result.ok).toBe(true);
    const second = await tool(t.http, DENTAL, "book_appointment", { ...args, name: "B", phone: "3125550145" });
    expect(second.result).toMatchObject({ ok: false, error: "slot_unavailable" });
    expect(second.result.alternatives.every((a: any) => a.slot_start !== slot)).toBe(true);
  });

  it("asks for the phone again when it is incomplete", async () => {
    const slot = await firstSlot();
    const { result } = await tool(t.http, DENTAL, "book_appointment", { slot_start: slot, name: "A", phone: "555-01" });
    expect(result).toMatchObject({ ok: false, error: "invalid_phone" });
    expect(t.ctx.db.prepare("SELECT count(*) n FROM appointments").get()).toEqual({ n: 0 });
  });

  it("turns a calendar failure during booking into a callback offer", async () => {
    const slot = await firstSlot();
    setCalendarOutage(t.ctx.db, DENTAL, true);
    const { result } = await tool(t.http, DENTAL, "book_appointment", { slot_start: slot, name: "A", phone: "3125550144" });
    expect(result.fallback).toBe("take_callback");
    const cb = await tool(t.http, DENTAL, "request_callback", { name: "A", phone: "3125550144", reason: "cleaning", preferred_time: "tomorrow morning" });
    expect(cb.result.ok).toBe(true);
    const lead = t.ctx.db.prepare("SELECT status, qualification_json FROM leads").get() as any;
    expect(lead.status).toBe("callback_requested");
    expect(JSON.parse(lead.qualification_json).callback_time).toBe("tomorrow morning");
  });
});

describe("create_lead qualification", () => {
  const base = { name: "Pat Doe", phone: "303-555-0190" };

  it("qualifies a homeowner in the service area", async () => {
    const { result } = await tool(t.http, ROOF, "create_lead", {
      ...base,
      answers: { zip: "80401", owner: "Yes", property_type: "residential", urgency: "soon" },
    });
    expect(result).toMatchObject({ ok: true, qualified: true });
  });

  it("marks out-of-area renters as not a fit with every reason", async () => {
    const { result } = await tool(t.http, ROOF, "create_lead", {
      ...base,
      answers: { zip: "90210", owner: "no", property_type: "residential", urgency: "planning" },
    });
    expect(result.qualified).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect((t.ctx.db.prepare("SELECT status FROM leads").get() as any).status).toBe("not_fit");
  });

  it("reports missing answers instead of guessing", async () => {
    const { result } = await tool(t.http, ROOF, "create_lead", { ...base, answers: { zip: "80401" } });
    expect(result.qualified).toBeNull();
    expect(result.missing).toEqual(["owner", "property_type", "urgency"]);
  });
});

describe("transfer_to_human and mark_do_not_call", () => {
  it("logs a simulated transfer on web calls", async () => {
    const { result, sessionId } = await tool(t.http, DENTAL, "transfer_to_human", { reason: "billing question" });
    expect(result).toMatchObject({ ok: true, mode: "simulated", target: "the front desk" });
    const call = t.ctx.db.prepare("SELECT id FROM calls WHERE session_id = ?").get(sessionId) as any;
    const ev = t.ctx.db.prepare("SELECT name FROM event_log WHERE call_id = ? AND name = 'transferred'").get(call.id);
    expect(ev).toBeTruthy();
  });

  it("puts the caller on the do-not-call list immediately", async () => {
    const { result } = await tool(t.http, ROOF, "mark_do_not_call", { phone: "(303) 555-0177" });
    expect(result.ok).toBe(true);
    expect(isSuppressed(t.ctx.db, "+13035550177")).toBe(true);
  });

  it("asks for a number when there is none to suppress", async () => {
    const { result } = await tool(t.http, ROOF, "mark_do_not_call", {});
    expect(result.error).toBe("phone_required");
  });
});
