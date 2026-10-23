import crypto from "node:crypto";
import type { DB } from "./db/index.js";

export type Direction = "inbound" | "outbound";
export type Outcome = "Booked" | "Qualified" | "NotFit" | "Transferred" | "OptOut" | "Callback" | "Incomplete";

export interface CallRow {
  id: number;
  session_id: string;
  vapi_call_id: string | null;
  profile_id: string;
  direction: Direction;
  transport: "web" | "phone";
  lead_id: number | null;
  status: string;
  outcome: Outcome | null;
  summary: string | null;
  transcript_json: string | null;
  ended_reason: string | null;
  recording_path: string | null;
  started_at: string;
  ended_at: string | null;
}

export function createCall(
  db: DB,
  input: { profileId: string; direction: Direction; transport: "web" | "phone"; leadId?: number | null; vapiCallId?: string | null },
): CallRow {
  const sessionId = crypto.randomUUID();
  const res = db
    .prepare("INSERT INTO calls (session_id, vapi_call_id, profile_id, direction, transport, lead_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(sessionId, input.vapiCallId ?? null, input.profileId, input.direction, input.transport, input.leadId ?? null);
  return getCall(db, Number(res.lastInsertRowid))!;
}

export function getCall(db: DB, id: number): CallRow | null {
  return (db.prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | undefined) ?? null;
}

export function getCallBySession(db: DB, sessionId: string): CallRow | null {
  return (db.prepare("SELECT * FROM calls WHERE session_id = ?").get(sessionId) as CallRow | undefined) ?? null;
}

export function getCallByVapiId(db: DB, vapiCallId: string): CallRow | null {
  return (db.prepare("SELECT * FROM calls WHERE vapi_call_id = ?").get(vapiCallId) as CallRow | undefined) ?? null;
}

export function attachVapiCall(db: DB, callId: number, vapiCallId: string) {
  db.prepare("UPDATE calls SET vapi_call_id = COALESCE(vapi_call_id, ?), status = 'in_progress' WHERE id = ?").run(vapiCallId, callId);
}

export function setCallLead(db: DB, callId: number, leadId: number) {
  db.prepare("UPDATE calls SET lead_id = ? WHERE id = ?").run(leadId, callId);
}

export function finishCall(
  db: DB,
  callId: number,
  f: { outcome: Outcome; summary: string; transcript: unknown; endedReason?: string | null; recordingPath?: string | null },
) {
  db.prepare(
    `UPDATE calls SET status = 'ended', outcome = ?, summary = ?, transcript_json = ?, ended_reason = ?,
       recording_path = COALESCE(?, recording_path), ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).run(f.outcome, f.summary, JSON.stringify(f.transcript ?? []), f.endedReason ?? null, f.recordingPath ?? null, callId);
}

/** Tool events recorded during the call decide the outcome; the LLM only breaks ties between Qualified / NotFit. */
export function outcomeFromEvents(db: DB, callId: number): Outcome | null {
  const names = new Set(
    (db.prepare("SELECT name FROM event_log WHERE call_id = ? AND kind = 'tool'").all(callId) as { name: string }[]).map((r) => r.name),
  );
  if (names.has("opted_out")) return "OptOut";
  if (names.has("booked")) return "Booked";
  if (names.has("transferred")) return "Transferred";
  if (names.has("callback_requested")) return "Callback";
  if (names.has("lead_not_fit")) return "NotFit";
  if (names.has("lead_qualified")) return "Qualified";
  return null;
}
