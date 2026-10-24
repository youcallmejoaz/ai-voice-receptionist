import fs from "node:fs";
import express, { Router, type Request } from "express";
import { z } from "zod";
import { clearSession, hasValidSession, issueSession, requireAdmin, safeEqual } from "../auth.js";
import { attachVapiCall, createCall, getCall, getCallBySession } from "../calls.js";
import { telephonyEnabled, type AppContext } from "../context.js";
import { getLead, listLeads } from "../crm/leads.js";
import { listSuppression } from "../crm/suppression.js";
import { importLeads, importSuppression, listJobs, runOutbound, startSandboxCall } from "../outbound/dialer.js";
import { ProfileValidationError } from "../profiles/loader.js";
import { loadProfilesFromDir } from "../profiles/loader.js";
import { getProfile, listProfiles, seedProfiles, setCalendarOutage, updateProfile } from "../profiles/store.js";
import { addDays, localDate, zonedToUtc } from "../util/time.js";
import { assistantFor, syncAssistant } from "./assistant-sync.js";

function tooManyAttempts(loginAttempts: Map<string, { n: number; resetAt: number }>, ip: string) {
  const now = Date.now();
  const a = loginAttempts.get(ip);
  if (!a || a.resetAt < now) {
    loginAttempts.set(ip, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  a.n++;
  return a.n > 5;
}

const profileId = (req: Request) => String(req.query.profileId ?? req.body?.profileId ?? "");

export function adminRoutes(app: AppContext) {
  const { db, cfg } = app;
  const r = Router();
  const loginAttempts = new Map<string, { n: number; resetAt: number }>();

  // ------------------------------------------------------------ auth (public)
  r.post("/auth/login", (req, res) => {
    if (tooManyAttempts(loginAttempts, req.ip ?? "unknown")) return void res.status(429).json({ error: "Too many attempts, wait a minute" });
    const password = String(req.body?.password ?? "");
    if (!cfg.adminPassword || !safeEqual(password, cfg.adminPassword)) return void res.status(401).json({ error: "Wrong password" });
    issueSession(cfg, res);
    res.json({ ok: true });
  });
  r.post("/auth/logout", (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });
  r.get("/auth/me", (req, res) => res.json({ authenticated: hasValidSession(cfg, req) }));

  // ------------------------------------------------------------ everything below needs a session
  r.use(requireAdmin(cfg));

  r.get("/config", (_req, res) =>
    res.json({
      vapiPublicKey: cfg.vapiPublicKey || null,
      vapiConfigured: Boolean(app.vapi),
      telephonyEnabled: telephonyEnabled(app),
      calendarProvider: app.calendar.name,
      crm: app.crm.name,
      claudeSummaries: Boolean(cfg.anthropicApiKey),
    }),
  );

  // ------------------------------------------------------------ profiles
  r.get("/profiles", (_req, res) =>
    res.json(
      listProfiles(db).map((s) => ({
        id: s.profile.id,
        name: s.profile.name,
        industry: s.profile.industry,
        agentName: s.profile.agent.name,
        synced: Boolean(s.vapiAssistantId),
        calendarOutage: s.calendarOutage,
      })),
    ),
  );

  r.get("/profiles/:id", (req, res) => {
    const s = getProfile(db, req.params.id);
    if (!s) return void res.status(404).json({ error: "Unknown profile" });
    res.json({ profile: s.profile, synced: Boolean(s.vapiAssistantId), calendarOutage: s.calendarOutage, updatedAt: s.updatedAt });
  });

  r.patch("/profiles/:id", async (req, res) => {
    try {
      const profile = updateProfile(db, req.params.id, req.body);
      let syncError: string | null = null;
      if (app.vapi) await syncAssistant(app, profile.id).catch((e) => (syncError = (e as Error).message));
      res.json({ profile, syncError });
    } catch (e) {
      if (e instanceof ProfileValidationError) return void res.status(400).json({ error: "Invalid profile", issues: e.issues });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "Invalid profile", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      throw e;
    }
  });

  r.post("/profiles/:id/outage", (req, res) => {
    setCalendarOutage(db, req.params.id, Boolean(req.body?.on));
    res.json({ ok: true, calendarOutage: Boolean(req.body?.on) });
  });

  r.post("/profiles/:id/sync", async (req, res) => {
    try {
      res.json({ assistantId: await syncAssistant(app, req.params.id) });
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });

  /** What gets sent to Vapi, with the webhook secret redacted. */
  r.get("/profiles/:id/assistant", (req, res) => {
    const a = JSON.parse(JSON.stringify(assistantFor(app, req.params.id)).replaceAll(cfg.vapiWebhookSecret || "\u0000", "[redacted]"));
    res.json(a);
  });

  r.get("/profiles/:id/export", (req, res) => {
    const s = getProfile(db, req.params.id);
    if (!s) return void res.status(404).end();
    res.setHeader("content-disposition", `attachment; filename="${s.profile.id}.json"`);
    res.json(s.profile);
  });

  // ------------------------------------------------------------ web calls
  /** Prepare a browser call: creates our call record and returns the overrides the SDK passes to Vapi. */
  r.post("/calls/web", (req, res) => {
    const s = getProfile(db, profileId(req));
    if (!s) return void res.status(404).json({ error: "Unknown profile" });
    if (!s.vapiAssistantId) return void res.status(409).json({ error: "Sync this profile to Vapi first" });
    const call = createCall(db, { profileId: s.profile.id, direction: "inbound", transport: "web" });
    res.json({
      sessionId: call.session_id,
      callId: call.id,
      assistantId: s.vapiAssistantId,
      assistantOverrides: { variableValues: { sessionId: call.session_id, callContext: "INBOUND web call. There is no caller ID, so ask for a phone number." } },
    });
  });

  r.post("/calls/:sessionId/attach", (req, res) => {
    const call = getCallBySession(db, req.params.sessionId);
    const vapiCallId = String(req.body?.vapiCallId ?? "");
    if (!call || !vapiCallId) return void res.status(400).json({ error: "Unknown session or missing vapiCallId" });
    attachVapiCall(db, call.id, vapiCallId);
    res.json({ ok: true, callId: call.id });
  });

  r.get("/calls", (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.direction, c.transport, c.status, c.outcome, c.summary, c.started_at AS startedAt, c.ended_at AS endedAt,
                l.name AS leadName, c.recording_path IS NOT NULL AS hasRecording
           FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
          WHERE c.profile_id = ? AND (c.status != 'created' OR c.started_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'))
          ORDER BY c.id DESC LIMIT 200`,
      )
      .all(profileId(req));
    res.json(rows);
  });

  r.get("/calls/:id", (req, res) => {
    const call = getCall(db, Number(req.params.id));
    if (!call) return void res.status(404).json({ error: "Unknown call" });
    const events = db.prepare("SELECT kind, name, detail, ts FROM event_log WHERE call_id = ? ORDER BY id").all(call.id) as {
      detail: string;
    }[];
    res.json({
      id: call.id,
      profileId: call.profile_id,
      direction: call.direction,
      transport: call.transport,
      status: call.status,
      outcome: call.outcome,
      summary: call.summary,
      endedReason: call.ended_reason,
      startedAt: call.started_at,
      endedAt: call.ended_at,
      transcript: call.transcript_json ? JSON.parse(call.transcript_json) : [],
      hasRecording: Boolean(call.recording_path),
      lead: call.lead_id ? getLead(db, call.lead_id) : null,
      appointments: db.prepare("SELECT service, start_utc AS startUtc, end_utc AS endUtc, status FROM appointments WHERE call_id = ?").all(call.id),
      events: events.map((e) => ({ ...e, detail: JSON.parse(e.detail) })),
    });
  });

  r.get("/calls/:id/recording", (req, res) => {
    const call = getCall(db, Number(req.params.id));
    const file = call?.recording_path ? app.recordings.resolve(call.recording_path) : null;
    if (!file) return void res.status(404).end();
    res.setHeader("cache-control", "private, no-store");
    res.type(file.endsWith(".wav") ? "audio/wav" : "audio/mpeg");
    fs.createReadStream(file).pipe(res);
  });

  // ------------------------------------------------------------ CRM, calendar, events
  r.get("/leads", (req, res) => res.json(listLeads(db, profileId(req))));

  r.get("/calendar", (req, res) => {
    const s = getProfile(db, profileId(req));
    if (!s) return void res.status(404).json({ error: "Unknown profile" });
    const days = Math.min(14, Number(req.query.days ?? 7));
    const today = localDate(app.now(), s.profile.timezone);
    const from = zonedToUtc(today, "00:00", s.profile.timezone).toISOString();
    const to = zonedToUtc(addDays(today, days), "00:00", s.profile.timezone).toISOString();
    res.json({
      timezone: s.profile.timezone,
      provider: app.calendar.name,
      now: app.now().toISOString(),
      slots: db
        .prepare("SELECT start_utc AS startUtc, end_utc AS endUtc, booked FROM slots WHERE profile_id = ? AND start_utc >= ? AND start_utc < ? ORDER BY start_utc")
        .all(s.profile.id, from, to),
      appointments: db
        .prepare(
          `SELECT a.id, a.service, a.start_utc AS startUtc, a.end_utc AS endUtc, a.call_id AS callId, l.name AS leadName
             FROM appointments a LEFT JOIN leads l ON l.id = a.lead_id
            WHERE a.profile_id = ? AND a.start_utc >= ? AND a.start_utc < ? ORDER BY a.start_utc`,
        )
        .all(s.profile.id, from, to),
    });
  });

  r.get("/events", (req, res) => {
    const since = Number(req.query.since ?? 0);
    res.json(
      (
        db
          .prepare("SELECT id, call_id AS callId, kind, name, detail, ts FROM event_log WHERE profile_id = ? AND id > ? ORDER BY id DESC LIMIT 100")
          .all(profileId(req), since) as { detail: string }[]
      ).map((e) => ({ ...e, detail: JSON.parse(e.detail) })),
    );
  });

  // ------------------------------------------------------------ outbound
  const csvBody = express.text({ type: ["text/csv", "text/plain"], limit: "1mb" });

  r.get("/outbound", (req, res) => res.json(listJobs(app, profileId(req))));
  r.post("/outbound/import", csvBody, (req, res) => {
    const s = getProfile(db, profileId(req));
    if (!s) return void res.status(404).json({ error: "Unknown profile" });
    const result = importLeads(app, s.profile.id, String(req.body ?? ""));
    res.status(result.imported ? 200 : 400).json(result);
  });
  r.post("/outbound/run", async (req, res) => res.json(await runOutbound(app, profileId(req))));
  r.post("/outbound/:jobId/start", (req, res) => {
    const result = startSandboxCall(app, Number(req.params.jobId));
    if (!result.ok) return void res.status(409).json(result);
    res.json({ sessionId: result.call.session_id, callId: result.call.id, assistantId: result.assistantId, assistantOverrides: result.assistantOverrides });
  });

  r.get("/suppression", (_req, res) => res.json(listSuppression(db)));
  r.post("/suppression/import", csvBody, (req, res) => res.json(importSuppression(app, String(req.body ?? ""))));

  // ------------------------------------------------------------ demo reset (clears this profile's calls, leads and edits)
  r.post("/demo/reset", (req, res) => {
    const id = profileId(req);
    const s = getProfile(db, id);
    if (!s) return void res.status(404).json({ error: "Unknown profile" });
    db.transaction(() => {
      db.prepare("DELETE FROM event_log WHERE profile_id = ?").run(id);
      db.prepare("DELETE FROM outbound_jobs WHERE profile_id = ?").run(id);
      db.prepare("DELETE FROM appointments WHERE profile_id = ?").run(id);
      db.prepare("DELETE FROM calls WHERE profile_id = ?").run(id);
      db.prepare("DELETE FROM leads WHERE profile_id = ?").run(id);
      db.prepare("DELETE FROM slots WHERE profile_id = ?").run(id);
    })();
    setCalendarOutage(db, id, false);
    // restore the profile from its config file, discarding dashboard edits
    const fromFile = loadProfilesFromDir(cfg.profilesDir).find((p) => p.id === id);
    if (fromFile) seedProfiles(db, [fromFile], true);
    app.mockCalendar.ensureSlots(s.profile, app.now());
    res.json({ ok: true });
  });

  return r;
}
