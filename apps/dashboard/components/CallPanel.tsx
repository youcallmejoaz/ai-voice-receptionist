"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWebCall, type PreparedCall } from "./useWebCall";

interface EventRow {
  id: number;
  callId: number | null;
  kind: string;
  name: string;
  detail: Record<string, any>;
  ts: string;
}

const EVENT_TEXT: Record<string, (d: any) => string> = {
  invoke: (d) => `${d.tool}() ${d.ok ? "✓" : `→ ${d.error}`}`,
  booked: () => "Appointment booked in calendar",
  calendar_failure: () => "Calendar unavailable: falling back to a callback request",
  callback_requested: () => "Callback request saved to CRM",
  lead_qualified: () => "Lead qualified, saved to CRM",
  lead_not_fit: (d) => `Not a fit: ${d.failedReasons?.join("; ")}`,
  lead_incomplete: (d) => `Lead saved, missing: ${d.missing?.join(", ")}`,
  transferred: (d) => `Transfer to ${d.target} (${d.mode}): ${d.reason}`,
  opted_out: () => "Added to do-not-call list",
  call_ended: (d) => `Call ended: outcome ${d.outcome}`,
};

export function describeEvent(e: EventRow) {
  return EVENT_TEXT[e.name]?.(e.detail) ?? e.name;
}

/** One live call: start/stop, live transcript, and the tool activity the agent triggers. */
export function CallPanel({
  publicKey,
  prepare,
  profileId,
  title,
  startLabel = "Start web call",
}: {
  publicKey: string | null;
  prepare: () => Promise<PreparedCall>;
  profileId: string;
  title: string;
  startLabel?: string;
}) {
  const call = useWebCall(publicKey);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [seconds, setSeconds] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (call.status !== "live") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [call.status]);

  useEffect(() => {
    if (!call.callId || call.status === "idle") return;
    let stop = false;
    const poll = async () => {
      const rows = await api<EventRow[]>(`/api/events?profileId=${profileId}`).catch(() => []);
      if (!stop) setEvents(rows.filter((r) => r.callId === call.callId).reverse());
    };
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [call.callId, call.status, profileId]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [call.lines]);

  const live = call.status === "live" || call.status === "connecting";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="call-grid">
      <section className="card call-card">
        <h2>{title}</h2>
        <div className={`call-orb ${call.agentSpeaking ? "speaking" : ""} ${live ? "live" : ""}`} style={{ ["--vol" as string]: call.volume }}>
          <span>{call.status === "live" ? mmss : call.status === "connecting" ? "…" : "●"}</span>
        </div>
        <p className="call-status" data-testid="call-status">
          {call.status === "idle" && "Ready"}
          {call.status === "connecting" && "Connecting…"}
          {call.status === "live" && (call.agentSpeaking ? "Agent speaking" : "Listening")}
          {call.status === "ended" && "Call ended"}
          {call.status === "error" && "Call failed"}
        </p>
        {call.error && <p className="error">{call.error}</p>}
        <div className="row center">
          {!live ? (
            <button className="primary big" onClick={() => call.start(prepare)} data-testid="start-call">
              {startLabel}
            </button>
          ) : (
            <>
              <button onClick={call.toggleMute}>{call.muted ? "Unmute" : "Mute"}</button>
              <button className="danger" onClick={call.stop} data-testid="end-call">
                End call
              </button>
            </>
          )}
        </div>
        {call.status === "ended" && call.callId && (
          <p className="muted small">
            Summary and recording appear in the <Link href={`/calls/${call.callId}`}>call log</Link> within a few seconds.
          </p>
        )}
        <div className="activity">
          <h3>Agent actions</h3>
          {events.length === 0 && <p className="muted small">Tool calls show up here as they happen.</p>}
          <ul>
            {events.map((e) => (
              <li key={e.id} className={`ev ev-${e.name}`}>
                <time>{new Date(e.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
                {describeEvent(e)}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="card transcript-card">
        <h2>Live transcript</h2>
        <div className="transcript" ref={transcriptRef} data-testid="live-transcript">
          {call.lines.length === 0 && <p className="muted">The conversation appears here as it happens.</p>}
          {call.lines.map((l, i) => (
            <div key={i} className={`bubble ${l.role} ${l.final ? "" : "partial"}`}>
              <span className="who">{l.role === "agent" ? "Agent" : "Caller"}</span>
              {l.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
