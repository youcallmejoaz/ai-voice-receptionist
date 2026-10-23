import { attachVapiCall, createCall, finishCall, getCall, getCallBySession, getCallByVapiId, outcomeFromEvents, type CallRow, type Outcome } from "../calls.js";
import { telephonyEnabled, type AppContext } from "../context.js";
import { logEvent } from "../db/index.js";
import { findProfileByAssistantId, getProfile } from "../profiles/store.js";
import type { BusinessProfile } from "../profiles/schema.js";
import type { TranscriptLine } from "../summary/index.js";
import type { ToolContext } from "../tools/context.js";
import { runTool } from "../tools/registry.js";
import { VapiServerMessage, type VapiCallInfo } from "./messages.js";

interface Resolved {
  call: CallRow;
  profile: BusinessProfile;
}

/**
 * Map a Vapi call to our call record. Web and outbound calls carry our sessionId in
 * variableValues; inbound phone calls are matched by assistant id and created on first sight.
 */
export function resolveCall(app: AppContext, vc: VapiCallInfo | null | undefined): Resolved | null {
  if (!vc) return null;
  const { db } = app;
  let call = getCallByVapiId(db, vc.id);
  if (!call) {
    const sessionId = vc.assistantOverrides?.variableValues?.sessionId;
    if (typeof sessionId === "string") {
      call = getCallBySession(db, sessionId);
      if (call) {
        attachVapiCall(db, call.id, vc.id);
        call = getCall(db, call.id);
      }
    }
  }
  if (!call) {
    const metaProfile = vc.assistantOverrides?.metadata?.profileId ?? vc.metadata?.profileId;
    const stored =
      (typeof metaProfile === "string" ? getProfile(db, metaProfile) : null) ??
      (vc.assistantId ? findProfileByAssistantId(db, vc.assistantId) : null);
    if (!stored) return null;
    call = createCall(db, {
      profileId: stored.profile.id,
      direction: vc.type === "outboundPhoneCall" ? "outbound" : "inbound",
      transport: vc.type?.includes("Phone") ? "phone" : "web",
      vapiCallId: vc.id,
    });
  }
  const stored = getProfile(db, call!.profile_id);
  return stored ? { call: call!, profile: stored.profile } : null;
}

export function toolContext(app: AppContext, r: Resolved, customerPhone: string | null): ToolContext {
  return {
    db: app.db,
    calendar: app.calendar,
    crm: app.crm,
    profile: r.profile,
    call: r.call,
    customerPhone,
    telephonyEnabled: telephonyEnabled(app),
    now: app.now,
  };
}

/** Handle one Vapi server message. Returns the JSON body to send back. */
export async function handleServerMessage(app: AppContext, body: unknown): Promise<Record<string, unknown>> {
  const parsed = VapiServerMessage.safeParse(body);
  if (!parsed.success) {
    console.warn("ignoring unrecognised Vapi message", parsed.error.issues.slice(0, 3));
    return {};
  }
  const msg = parsed.data.message;
  const resolved = resolveCall(app, msg.call);

  switch (msg.type) {
    case "tool-calls": {
      const calls = msg.toolCallList ?? [];
      if (!resolved) {
        return {
          results: calls.map((c) => ({
            toolCallId: c.id,
            result: JSON.stringify({ ok: false, error: "unknown_business", fallback: "offer_transfer" }),
          })),
        };
      }
      const ctx = toolContext(app, resolved, msg.call?.customer?.number ?? null);
      const results = [];
      for (const c of calls) {
        // re-read the call each time so a lead created by one tool is visible to the next
        ctx.call = getCall(app.db, resolved.call.id);
        const result = await runTool(ctx, c.function.name, c.function.arguments ?? {});
        results.push({ toolCallId: c.id, result: JSON.stringify(result) });
      }
      return { results };
    }
    case "status-update": {
      if (resolved && msg.status === "in-progress") {
        app.db.prepare("UPDATE calls SET status = 'in_progress' WHERE id = ? AND status = 'created'").run(resolved.call.id);
      }
      return {};
    }
    case "end-of-call-report": {
      if (resolved) await finalizeCall(app, resolved, msg);
      return {};
    }
    default:
      return {};
  }
}

export function transcriptFromArtifact(msg: VapiServerMessage): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const m of msg.artifact?.messages ?? []) {
    if (!m.message) continue;
    if (m.role === "bot" || m.role === "assistant") lines.push({ role: "agent", text: m.message, secondsFromStart: m.secondsFromStart });
    else if (m.role === "user") lines.push({ role: "caller", text: m.message, secondsFromStart: m.secondsFromStart });
  }
  if (!lines.length && msg.artifact?.transcript) {
    for (const raw of msg.artifact.transcript.split("\n")) {
      const m = raw.match(/^(AI|Assistant|Bot|User|Customer):\s*(.*)$/i);
      if (m) lines.push({ role: /user|customer/i.test(m[1]) ? "caller" : "agent", text: m[2] });
    }
  }
  return lines;
}

const GUESS_TO_OUTCOME: Record<string, Outcome> = { Qualified: "Qualified", NotFit: "NotFit", Incomplete: "Incomplete" };

export async function finalizeCall(app: AppContext, r: Resolved, msg: VapiServerMessage) {
  const current = getCall(app.db, r.call.id);
  if (!current || current.status === "ended") return; // Vapi may retry; finalize once
  const transcript = transcriptFromArtifact(msg);
  const toolEvents = (
    app.db.prepare("SELECT name FROM event_log WHERE call_id = ? AND kind = 'tool' AND name != 'invoke' ORDER BY id").all(r.call.id) as {
      name: string;
    }[]
  ).map((e) => e.name);

  const summary = await app.summarizer.summarize({
    profile: r.profile,
    direction: r.call.direction,
    transcript,
    toolEvents,
    platformSummary: msg.analysis?.summary ?? msg.summary ?? null,
  });
  const outcome = outcomeFromEvents(app.db, r.call.id) ?? GUESS_TO_OUTCOME[summary.outcome_guess] ?? "Incomplete";

  const recordingUrl = msg.artifact?.recordingUrl ?? msg.artifact?.recording?.mono?.combinedUrl ?? msg.recordingUrl ?? null;
  const recordingPath = recordingUrl ? await app.recordings.download(recordingUrl, r.call.id) : null;

  const fullSummary = [summary.summary, summary.follow_up ? `Next step: ${summary.follow_up}` : null].filter(Boolean).join("\n");
  finishCall(app.db, r.call.id, { outcome, summary: fullSummary, transcript, endedReason: msg.endedReason, recordingPath });
  app.db.prepare("UPDATE outbound_jobs SET status = 'called', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE call_id = ?").run(
    r.call.id,
  );
  logEvent(app.db, { callId: r.call.id, profileId: r.profile.id, kind: "system", name: "call_ended", detail: { outcome, endedReason: msg.endedReason } });
}
