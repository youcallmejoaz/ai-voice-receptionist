import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertLead } from "../src/crm/leads.js";
import { addSuppression, isSuppressed } from "../src/crm/suppression.js";
import { parseLeadCsv } from "../src/outbound/csv.js";
import { importLeads, importSuppression, listJobs, runOutbound, startSandboxCall } from "../src/outbound/dialer.js";
import { checkOutbound } from "../src/outbound/gate.js";
import { getProfile } from "../src/profiles/store.js";
import { toE164 } from "../src/util/phone.js";
import { makeTestApp, REPO } from "./helpers.js";

const ROOF = "summit-roofing";
const leadsCsv = fs.readFileSync(path.join(REPO, "seed/leads.csv"), "utf8");
const dncCsv = fs.readFileSync(path.join(REPO, "seed/do-not-call.csv"), "utf8");

describe("phone normalisation", () => {
  it.each([
    ["(303) 555-0107", "+13035550107"],
    ["303.555.0107", "+13035550107"],
    ["+1 303 555 0107", "+13035550107"],
    ["13035550107", "+13035550107"],
    ["555-0107", null],
    ["", null],
  ])("%s -> %s", (input, expected) => expect(toE164(input)).toBe(expected));
});

describe("lead CSV", () => {
  it("parses the 15 sample leads with their consent", () => {
    const { rows, errors } = parseLeadCsv(leadsCsv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(15);
    expect(rows.filter((r) => r.consent)).toHaveLength(11);
  });

  it("rejects a file without a consent column", () => {
    const { rows, errors } = parseLeadCsv("name,phone\nA,3035550101\n");
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/consent/);
  });

  it("treats anything other than an explicit yes as no consent", () => {
    const { rows, errors } = parseLeadCsv("name,phone,consent\nA,3035550101,maybe\nB,3035550102,\nC,3035550103,YES\n");
    expect(rows.map((r) => r.consent)).toEqual([false, false, true]);
    expect(errors[0]).toMatch(/Row 2/);
  });
});

describe("outbound gate", () => {
  async function setup(now?: Date) {
    const t = await makeTestApp(now ? { now } : {});
    const profile = getProfile(t.ctx.db, ROOF)!.profile;
    const lead = (consent: boolean, phone = "303-555-0130") =>
      upsertLead(t.ctx.db, { profileId: ROOF, name: "Test", phone: toE164(phone), consent, source: "csv_import" });
    return { t, profile, lead };
  }

  it("allows a consenting lead in calling hours", async () => {
    const { t, profile, lead } = await setup();
    expect(checkOutbound(t.ctx.db, lead(true), profile, t.ctx.now())).toEqual({ allowed: true });
  });

  it("blocks no consent first, then do-not-call regardless of number formatting", async () => {
    const { t, profile, lead } = await setup();
    expect(checkOutbound(t.ctx.db, lead(false), profile, t.ctx.now())).toMatchObject({ allowed: false, reason: "no_consent" });
    addSuppression(t.ctx.db, "(303) 555 0131", "registry", "dnc_list");
    expect(checkOutbound(t.ctx.db, lead(true, "303.555.0131"), profile, t.ctx.now())).toMatchObject({ reason: "do_not_call" });
  });

  it("blocks calls outside 8am-9pm business time", async () => {
    const { t, profile, lead } = await setup(new Date("2026-10-27T04:00:00Z")); // 10pm Denver
    expect(checkOutbound(t.ctx.db, lead(true), profile, t.ctx.now())).toMatchObject({ reason: "outside_calling_hours" });
  });

  it("blocks leads without a usable number", async () => {
    const { t, profile } = await setup();
    const l = upsertLead(t.ctx.db, { profileId: ROOF, name: "X", phone: null, consent: true, source: "csv_import" });
    expect(checkOutbound(t.ctx.db, l, profile, t.ctx.now())).toMatchObject({ reason: "invalid_number" });
  });
});

describe("running the outbound list", () => {
  it("skips and logs no-consent and do-not-call leads; the rest are ready (no telephony configured)", async () => {
    const t = await makeTestApp();
    importSuppression(t.ctx, dncCsv);
    expect(importLeads(t.ctx, ROOF, leadsCsv).imported).toBe(15);
    const summary = await runOutbound(t.ctx, ROOF);
    expect(summary).toMatchObject({ checked: 15, skipped: 6, ready: 9, dialled: 0 });

    const jobs = listJobs(t.ctx, ROOF);
    const by = (name: string) => jobs.find((j) => j.name === name)!;
    expect(by("Tom Becker")).toMatchObject({ status: "skipped", skipReason: "No recorded consent to call" });
    expect(by("Hannah Kowalski")).toMatchObject({ status: "skipped", skipReason: "Number is on the do-not-call list" });
    expect(by("Dana Whitfield").status).toBe("ready");

    const log = t.ctx.db.prepare("SELECT detail FROM event_log WHERE kind = 'outbound' AND name = 'skipped'").all() as { detail: string }[];
    expect(log).toHaveLength(6);
    const hannah = log.map((l) => JSON.parse(l.detail)).find((d) => d.lead === "Hannah Kowalski");
    expect(hannah).toMatchObject({ reason: "do_not_call", phone: "•••0107" }); // full number never logged
  });

  it("re-checks the gate right before a sandbox call starts", async () => {
    const t = await makeTestApp();
    t.ctx.db.prepare("UPDATE profiles SET vapi_assistant_id = 'asst_roof' WHERE id = ?").run(ROOF);
    importLeads(t.ctx, ROOF, leadsCsv);
    await runOutbound(t.ctx, ROOF);
    const dana = listJobs(t.ctx, ROOF).find((j) => j.name === "Dana Whitfield")!;
    const marcus = listJobs(t.ctx, ROOF).find((j) => j.name === "Marcus Lee")!;

    const ok = startSandboxCall(t.ctx, dana.id);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.assistantOverrides.firstMessage).toMatch(/^Hi, is this Dana\?.*AI assistant/);
      expect(ok.call).toMatchObject({ direction: "outbound", transport: "web" });
    }

    addSuppression(t.ctx.db, "303-555-0102", "asked by email", "admin"); // Marcus opts out after the run
    const blocked = startSandboxCall(t.ctx, marcus.id);
    expect(blocked).toEqual({ ok: false, error: "Number is on the do-not-call list" });
    expect(listJobs(t.ctx, ROOF).find((j) => j.name === "Marcus Lee")!.status).toBe("skipped");
  });

  it("quiet hours defer leads (still queued) instead of skipping them", async () => {
    const t = await makeTestApp({ now: new Date("2026-10-27T04:00:00Z") }); // 10pm Denver
    importSuppression(t.ctx, dncCsv);
    importLeads(t.ctx, ROOF, leadsCsv);
    expect(await runOutbound(t.ctx, ROOF)).toMatchObject({ skipped: 6, deferred: 9, ready: 0 });
    const dana = listJobs(t.ctx, ROOF).find((j) => j.name === "Dana Whitfield")!;
    expect(dana).toMatchObject({ status: "queued", skipReason: "Outside 8am-9pm calling hours" });
  });

  it("a caller who opts out during a call can never be called again", async () => {
    const t = await makeTestApp();
    t.ctx.db.prepare("UPDATE profiles SET vapi_assistant_id = 'asst_roof' WHERE id = ?").run(ROOF);
    importLeads(t.ctx, ROOF, "name,phone,consent\nRiley Stone,720-555-0160,yes\n");
    await runOutbound(t.ctx, ROOF);
    const job = listJobs(t.ctx, ROOF)[0];
    const start = startSandboxCall(t.ctx, job.id);
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const res = await t.http.post("/api/vapi/tools/mark_do_not_call").set("x-vapi-secret", "test-webhook-secret").send({ profileId: ROOF, sessionId: start.call.session_id, args: {} });
    expect(res.body.result.ok).toBe(true);
    expect(isSuppressed(t.ctx.db, "7205550160")).toBe(true);

    importLeads(t.ctx, ROOF, "name,phone,consent\nRiley Stone,720-555-0160,yes\n"); // re-imported with consent=yes
    await runOutbound(t.ctx, ROOF);
    expect(listJobs(t.ctx, ROOF).at(-1)).toMatchObject({ status: "skipped", skipReason: "Number is on the do-not-call list" });
  });
});
