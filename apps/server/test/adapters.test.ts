import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CalendarUnavailableError, SlotTakenError } from "../src/calendar/adapter.js";
import { GoogleCalendar } from "../src/calendar/google.js";
import { WebhookCrm } from "../src/crm/adapter.js";
import { upsertLead } from "../src/crm/leads.js";
import { openDb } from "../src/db/index.js";
import { loadProfilesFromDir } from "../src/profiles/loader.js";
import { seedProfiles } from "../src/profiles/store.js";
import { REPO } from "./helpers.js";

const roofing = loadProfilesFromDir(path.join(REPO, "profiles")).find((p) => p.id === "summit-roofing")!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function googleFetch(busy: { start: string; end: string }[]) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("oauth2")) return json({ access_token: "tok", expires_in: 3600 });
    if (u.includes("freeBusy")) return json({ calendars: { primary: { busy } } });
    if (u.includes("/events")) return json({ id: "evt_123" });
    return json({}, 404);
  });
}

describe("Google Calendar adapter", () => {
  const opts = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };
  // Tuesday 27 Oct 2026 in Denver (UTC-6)
  const from = "2026-10-27T06:00:00.000Z";
  const to = "2026-10-28T06:00:00.000Z";

  it("returns business-hours slots minus busy time", async () => {
    const fetchFn = googleFetch([{ start: "2026-10-27T15:00:00Z", end: "2026-10-27T17:00:00Z" }]); // 9-11am local
    const cal = new GoogleCalendar({ ...opts, fetchFn: fetchFn as unknown as typeof fetch });
    const slots = await cal.listOpenSlots(roofing, from, to);
    const starts = slots.map((s) => s.startUtc);
    expect(starts[0]).toBe("2026-10-27T13:00:00.000Z"); // opens 7am
    expect(starts).not.toContain("2026-10-27T15:00:00.000Z");
    expect(starts).not.toContain("2026-10-27T16:00:00.000Z");
    expect(starts).toContain("2026-10-27T17:00:00.000Z");
    expect(starts.at(-1)).toBe("2026-10-27T23:00:00.000Z"); // last hour before 6pm close
  });

  it("books an event and refuses a slot that became busy", async () => {
    const free = new GoogleCalendar({ ...opts, fetchFn: googleFetch([]) as unknown as typeof fetch });
    const slot = { startUtc: "2026-10-27T17:00:00.000Z", endUtc: "2026-10-27T18:00:00.000Z" };
    expect(await free.book(roofing, slot, { name: "A", phone: "+13035550190", service: "Inspection" })).toEqual({ ref: "evt_123" });
    const busy = new GoogleCalendar({
      ...opts,
      fetchFn: googleFetch([{ start: slot.startUtc, end: slot.endUtc }]) as unknown as typeof fetch,
    });
    await expect(busy.book(roofing, slot, { name: "A", phone: "+1", service: "x" })).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("maps network and API errors to CalendarUnavailableError", async () => {
    const down = new GoogleCalendar({ ...opts, fetchFn: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
    await expect(down.listOpenSlots(roofing, from, to)).rejects.toBeInstanceOf(CalendarUnavailableError);
    const err = new GoogleCalendar({ ...opts, fetchFn: (async () => json({}, 503)) as unknown as typeof fetch });
    await expect(err.listOpenSlots(roofing, from, to)).rejects.toBeInstanceOf(CalendarUnavailableError);
  });
});

describe("CRM webhook adapter", () => {
  function setup() {
    const db = openDb(":memory:");
    seedProfiles(db, [roofing]);
    const lead = upsertLead(db, { profileId: roofing.id, name: "Pat", phone: "+13035550190", source: "inbound_call" });
    return { db, lead };
  }

  it("posts the lead as JSON and marks it pushed", async () => {
    const { db, lead } = setup();
    const fetchFn = vi.fn(async () => new Response("ok"));
    await new WebhookCrm(db, "https://crm.test/hook", fetchFn as unknown as typeof fetch).pushLead(lead, { profileName: "Summit", event: "lead_qualified" });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ event: "lead_qualified", business: "Summit", lead: { name: "Pat", phone: "+13035550190" } });
    expect((db.prepare("SELECT crm_pushed_at FROM leads").get() as any).crm_pushed_at).not.toBeNull();
  });

  it("retries once, then logs the failure without throwing", async () => {
    const { db, lead } = setup();
    const fetchFn = vi.fn(async () => new Response("down", { status: 500 }));
    await new WebhookCrm(db, "https://crm.test/hook", fetchFn as unknown as typeof fetch).pushLead(lead, { profileName: "S", event: "x" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT name FROM event_log").get()).toEqual({ name: "crm_push_failed" });
  });
});
