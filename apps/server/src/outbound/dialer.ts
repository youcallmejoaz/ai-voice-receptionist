import { createCall, getCall } from "../calls.js";
import { telephonyEnabled, type AppContext } from "../context.js";
import { getLead, upsertLead, type Lead } from "../crm/leads.js";
import { addSuppression } from "../crm/suppression.js";
import { logEvent } from "../db/index.js";
import { renderTemplate, withDisclosure } from "../assistant/prompt.js";
import type { BusinessProfile } from "../profiles/schema.js";
import { getProfile } from "../profiles/store.js";
import { maskPhone } from "../util/phone.js";
import { parseLeadCsv, parseSuppressionCsv } from "./csv.js";
import { checkOutbound } from "./gate.js";

export interface OutboundJob {
  id: number;
  leadId: number;
  name: string;
  phone: string | null;
  consent: boolean;
  interest: string | null;
  status: string;
  skipReason: string | null;
  callId: number | null;
  outcome: string | null;
}

export function importLeads(app: AppContext, profileId: string, csv: string) {
  const { rows, errors } = parseLeadCsv(csv);
  const insertJob = app.db.prepare("INSERT INTO outbound_jobs (profile_id, lead_id) VALUES (?, ?)");
  const tx = app.db.transaction(() => {
    for (const r of rows) {
      const lead = upsertLead(app.db, {
        profileId,
        name: r.name,
        phone: r.phone,
        email: r.email,
        interest: r.interest,
        consent: r.consent,
        source: "csv_import",
      });
      // consent from the newest import wins
      app.db.prepare("UPDATE leads SET consent = ? WHERE id = ?").run(r.consent ? 1 : 0, lead.id);
      insertJob.run(profileId, lead.id);
    }
  });
  tx();
  logEvent(app.db, { profileId, kind: "outbound", name: "csv_imported", detail: { rows: rows.length, errors } });
  return { imported: rows.length, errors };
}

export function importSuppression(app: AppContext, csv: string) {
  const { phones, errors } = parseSuppressionCsv(csv);
  for (const p of phones) addSuppression(app.db, p.phone, p.reason, "dnc_list");
  return { added: phones.length, errors };
}

export function listJobs(app: AppContext, profileId: string): OutboundJob[] {
  return app.db
    .prepare(
      `SELECT j.id, j.lead_id AS leadId, l.name, l.phone_e164 AS phone, l.consent, l.interest, j.status, j.skip_reason AS skipReason,
              j.call_id AS callId, c.outcome
         FROM outbound_jobs j JOIN leads l ON l.id = j.lead_id LEFT JOIN calls c ON c.id = j.call_id
        WHERE j.profile_id = ? ORDER BY j.id`,
    )
    .all(profileId)
    .map((r) => ({ ...(r as OutboundJob), consent: (r as { consent: number }).consent === 1 }));
}

function setJob(app: AppContext, id: number, status: string, skipReason: string | null = null, callId: number | null = null) {
  app.db
    .prepare(
      "UPDATE outbound_jobs SET status = ?, skip_reason = ?, call_id = COALESCE(?, call_id), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    )
    .run(status, skipReason, callId, id);
}

function outboundOverrides(profile: BusinessProfile, lead: Lead, sessionId: string) {
  const vars = { leadName: lead.name.split(" ")[0], leadInterest: lead.interest || "our services" };
  return {
    firstMessage: withDisclosure(renderTemplate(profile.outbound.firstMessage, vars), profile),
    variableValues: {
      sessionId,
      callContext: `OUTBOUND call to ${lead.name}, who asked about ${vars.leadInterest}. Their number on file ends in ${(lead.phone ?? "").slice(-4)}.`,
      ...vars,
    },
  };
}

/**
 * Run the list: every queued job goes through the consent / do-not-call gate. Blocked leads are
 * skipped with a log line. Allowed leads are dialled when telephony is configured; otherwise they
 * are marked ready for a sandbox web call from the dashboard (no real numbers in the demo).
 */
export async function runOutbound(app: AppContext, profileId: string) {
  const stored = getProfile(app.db, profileId);
  if (!stored) throw new Error(`Unknown profile ${profileId}`);
  const jobs = listJobs(app, profileId).filter((j) => j.status === "queued");
  const summary = { checked: jobs.length, skipped: 0, ready: 0, dialled: 0, failed: 0 };

  for (const job of jobs) {
    const lead = getLead(app.db, job.leadId)!;
    const gate = checkOutbound(app.db, lead, stored.profile, app.now());
    if (!gate.allowed) {
      setJob(app, job.id, "skipped", gate.message);
      logEvent(app.db, {
        profileId,
        kind: "outbound",
        name: "skipped",
        detail: { jobId: job.id, lead: lead.name, phone: maskPhone(lead.phone), reason: gate.reason, message: gate.message },
      });
      summary.skipped++;
      continue;
    }
    if (!telephonyEnabled(app) || !stored.vapiAssistantId) {
      setJob(app, job.id, "ready");
      logEvent(app.db, { profileId, kind: "outbound", name: "ready", detail: { jobId: job.id, lead: lead.name, phone: maskPhone(lead.phone) } });
      summary.ready++;
      continue;
    }
    const call = createCall(app.db, { profileId, direction: "outbound", transport: "phone", leadId: lead.id });
    try {
      const res = await app.vapi!.createPhoneCall({
        assistantId: stored.vapiAssistantId,
        phoneNumberId: app.cfg.vapiPhoneNumberId,
        customerNumber: lead.phone!,
        assistantOverrides: outboundOverrides(stored.profile, lead, call.session_id),
      });
      app.db.prepare("UPDATE calls SET vapi_call_id = ? WHERE id = ?").run(res.id, call.id);
      setJob(app, job.id, "calling", null, call.id);
      logEvent(app.db, { profileId, kind: "outbound", name: "dialled", detail: { jobId: job.id, lead: lead.name, phone: maskPhone(lead.phone) } });
      summary.dialled++;
    } catch (e) {
      setJob(app, job.id, "failed", (e as Error).message.slice(0, 200), call.id);
      summary.failed++;
    }
  }
  return summary;
}

/**
 * Start a sandbox (browser) outbound call for a job that passed the gate. The gate runs again
 * here: consent or do-not-call status may have changed since the list was run.
 */
export function startSandboxCall(app: AppContext, jobId: number) {
  const job = app.db.prepare("SELECT * FROM outbound_jobs WHERE id = ?").get(jobId) as
    | { id: number; profile_id: string; lead_id: number; status: string }
    | undefined;
  if (!job) return { ok: false as const, error: "Unknown job" };
  const stored = getProfile(app.db, job.profile_id)!;
  const lead = getLead(app.db, job.lead_id)!;
  const gate = checkOutbound(app.db, lead, stored.profile, app.now());
  if (!gate.allowed) {
    setJob(app, job.id, "skipped", gate.message);
    logEvent(app.db, {
      profileId: job.profile_id,
      kind: "outbound",
      name: "skipped",
      detail: { jobId: job.id, lead: lead.name, phone: maskPhone(lead.phone), reason: gate.reason, message: gate.message },
    });
    return { ok: false as const, error: gate.message };
  }
  if (!stored.vapiAssistantId) return { ok: false as const, error: "Assistant not synced to Vapi yet" };
  const call = createCall(app.db, { profileId: job.profile_id, direction: "outbound", transport: "web", leadId: lead.id });
  setJob(app, job.id, "calling", null, call.id);
  logEvent(app.db, { profileId: job.profile_id, kind: "outbound", name: "sandbox_call", detail: { jobId: job.id, lead: lead.name } });
  return {
    ok: true as const,
    call: getCall(app.db, call.id)!,
    assistantId: stored.vapiAssistantId,
    assistantOverrides: outboundOverrides(stored.profile, lead, call.session_id),
  };
}
