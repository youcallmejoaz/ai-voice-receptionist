import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssistant } from "../src/assistant/build.js";
import { buildSystemPrompt, withDisclosure } from "../src/assistant/prompt.js";
import { openDb } from "../src/db/index.js";
import { loadProfilesFromDir, parseProfile, ProfileValidationError } from "../src/profiles/loader.js";
import { getProfile, seedProfiles, updateProfile } from "../src/profiles/store.js";
import { TOOLS } from "../src/tools/registry.js";
import { REPO } from "./helpers.js";

const profilesDir = path.join(REPO, "profiles");
const load = () => loadProfilesFromDir(profilesDir);
const raw = (id: string) => JSON.parse(fs.readFileSync(path.join(profilesDir, `${id}.json`), "utf8"));

describe("profile loading", () => {
  it("loads both sample businesses", () => {
    const ids = load().map((p) => p.id);
    expect(ids).toEqual(["bright-smile-dental", "summit-roofing"]);
  });

  it("rejects an unknown timezone with the field path", () => {
    const bad = { ...raw("summit-roofing"), timezone: "Mars/Olympus" };
    expect(() => parseProfile(bad, "bad.json")).toThrow(/timezone: unknown IANA timezone/);
  });

  it("rejects opening hours where open is after close", () => {
    const bad = raw("summit-roofing");
    bad.hours.mon = { open: "18:00", close: "07:00" };
    expect(() => parseProfile(bad)).toThrow(ProfileValidationError);
  });

  it("rejects a profile without services or with a missing transfer target", () => {
    const noServices = { ...raw("bright-smile-dental"), services: [] };
    expect(() => parseProfile(noServices)).toThrow(/services/);
    const { transfer: _t, ...noTransfer } = raw("bright-smile-dental");
    expect(() => parseProfile(noTransfer)).toThrow(/transfer/);
  });

  it("rejects invalid JSON files and duplicate ids in a directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-"));
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(raw("summit-roofing")));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(raw("summit-roofing")));
    expect(() => loadProfilesFromDir(dir)).toThrow(/duplicate profile id/);
    fs.writeFileSync(path.join(dir, "b.json"), "{ not json");
    expect(() => loadProfilesFromDir(dir)).toThrow(/not valid JSON/);
  });

  it("keeps dashboard edits when profiles are re-seeded, and validates edits", () => {
    const db = openDb(":memory:");
    seedProfiles(db, load());
    updateProfile(db, "bright-smile-dental", { faqs: [{ q: "Open on Sundays?", a: "No, we are closed on Sundays." }] });
    seedProfiles(db, load());
    expect(getProfile(db, "bright-smile-dental")!.profile.faqs).toHaveLength(1);
    expect(() => updateProfile(db, "bright-smile-dental", { hours: { ...load()[0].hours, mon: { open: "25:00", close: "17:00" } } })).toThrow();
  });
});

describe("assistant built from a profile", () => {
  const opts = { webhookUrl: "https://x.test/api/vapi/webhook", webhookSecret: "s3cret", llmProvider: "anthropic", llmModel: "m", telephonyEnabled: false };

  it.each(["bright-smile-dental", "summit-roofing"])("%s: first sentence discloses AI", (id) => {
    const p = load().find((x) => x.id === id)!;
    expect(buildAssistant(p, opts).firstMessage).toMatch(/\bAI\b/);
  });

  it("adds a disclosure line when a greeting forgets it", () => {
    const p = load()[0];
    expect(withDisclosure("How can I help?", p)).toMatch(/^Hi, you're speaking with Ava, an AI assistant for Bright Smile Dental\./);
  });

  it("exposes every tool, pointing at our webhook with the secret header", () => {
    const a = buildAssistant(load()[1], opts);
    const names = a.model.tools.map((t: any) => t.function?.name);
    expect(names).toEqual(Object.keys(TOOLS));
    for (const t of a.model.tools as any[]) expect(t.server).toEqual({ url: opts.webhookUrl, headers: { "x-vapi-secret": "s3cret" } });
    expect((a.model.tools[0] as any).function.parameters.type).toBe("object");
  });

  it("only adds the live transferCall tool when telephony is configured", () => {
    const p = load()[1];
    expect(buildAssistant(p, opts).model.tools.some((t: any) => t.type === "transferCall")).toBe(false);
    const live = buildAssistant(p, { ...opts, telephonyEnabled: true }).model.tools.find((t: any) => t.type === "transferCall") as any;
    expect(live.destinations[0].number).toBe(p.transfer.number);
  });

  it("puts the business facts, fallbacks and do-not-call rule in the system prompt", () => {
    const p = load()[1];
    const prompt = buildSystemPrompt(p);
    for (const f of p.faqs) expect(prompt).toContain(f.a);
    expect(prompt).toContain("ask exactly one clarifying question");
    expect(prompt).toContain("calendar_unavailable");
    expect(prompt).toContain("mark_do_not_call");
    expect(prompt).toContain("Saturday: 08:00 to 12:00");
    expect(prompt).toContain("Sunday: closed");
  });
});
