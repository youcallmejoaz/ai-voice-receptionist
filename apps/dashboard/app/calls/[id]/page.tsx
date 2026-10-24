"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { OutcomeBadge } from "@/components/Badge";
import { describeEvent } from "@/components/CallPanel";
import { api, formatWhen } from "@/lib/api";

interface Detail {
  id: number;
  direction: string;
  transport: string;
  status: string;
  outcome: string | null;
  summary: string | null;
  endedReason: string | null;
  startedAt: string;
  endedAt: string | null;
  transcript: { role: "agent" | "caller"; text: string; secondsFromStart?: number }[];
  hasRecording: boolean;
  lead: null | {
    name: string;
    phone: string | null;
    email: string | null;
    interest: string | null;
    status: string;
    qualified: boolean | null;
    notFitReason: string | null;
    qualification: Record<string, string>;
  };
  appointments: { service: string; startUtc: string }[];
  events: { kind: string; name: string; detail: any; ts: string; id?: number; callId?: number }[];
}

const pretty = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      const detail = await api<Detail>(`/api/calls/${id}`).catch(() => null);
      setD(detail);
      if (detail && detail.status !== "ended") t = setTimeout(load, 3000);
    };
    load();
    return () => clearTimeout(t);
  }, [id]);

  if (!d) return <p className="muted">Loading…</p>;
  const duration = d.endedAt ? Math.round((Date.parse(d.endedAt) - Date.parse(d.startedAt)) / 1000) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted small">
            <Link href="/calls">← Call log</Link>
          </p>
          <h1>
            {d.direction === "inbound" ? "Inbound" : "Outbound"} call · {formatWhen(d.startedAt)}
          </h1>
          <p className="muted">
            {d.transport === "web" ? "Browser call" : "Phone call"}
            {duration !== null && ` · ${Math.floor(duration / 60)}m ${duration % 60}s`}
            {d.endedReason && ` · ended: ${d.endedReason}`}
          </p>
        </div>
        <div className="outcome-big" data-testid="call-outcome">
          <OutcomeBadge outcome={d.outcome} />
        </div>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="card" data-testid="call-summary">
            <h2>AI summary</h2>
            {d.summary ? d.summary.split("\n").map((p, i) => <p key={i}>{p}</p>) : <p className="muted">Summary is generated when the call ends.</p>}
          </section>

          <section className="card" data-testid="lead-fields">
            <h2>Lead</h2>
            {!d.lead ? (
              <p className="muted">No lead details captured.</p>
            ) : (
              <dl className="fields">
                <dt>Name</dt>
                <dd>{d.lead.name}</dd>
                <dt>Phone</dt>
                <dd>{d.lead.phone ?? "—"}</dd>
                {d.lead.email && (
                  <>
                    <dt>Email</dt>
                    <dd>{d.lead.email}</dd>
                  </>
                )}
                <dt>Interest</dt>
                <dd>{d.lead.interest ?? "—"}</dd>
                <dt>CRM status</dt>
                <dd>{pretty(d.lead.status)}</dd>
                {d.lead.notFitReason && (
                  <>
                    <dt>Not a fit</dt>
                    <dd>{d.lead.notFitReason}</dd>
                  </>
                )}
                {Object.entries(d.lead.qualification).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>{pretty(k)}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {d.appointments.map((a) => (
              <p key={a.startUtc} className="appt">
                📅 {a.service} · {formatWhen(a.startUtc)}
              </p>
            ))}
          </section>

          <section className="card">
            <h2>Recording</h2>
            {d.hasRecording ? (
              <audio controls preload="metadata" src={`/api/calls/${d.id}/recording`} data-testid="recording" style={{ width: "100%" }} />
            ) : (
              <p className="muted">No recording stored for this call.</p>
            )}
            <p className="muted small">Stored privately on this server; only signed-in admins can play it.</p>
          </section>

          <section className="card">
            <h2>Agent actions</h2>
            <ul className="activity-list">
              {d.events
                .filter((e) => e.kind === "tool" || e.name === "call_ended")
                .map((e, i) => (
                  <li key={i} className={`ev ev-${e.name}`}>
                    <time>{new Date(e.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
                    {describeEvent(e as any)}
                  </li>
                ))}
            </ul>
          </section>
        </div>

        <section className="card transcript-card">
          <h2>Transcript</h2>
          <div className="transcript tall">
            {d.transcript.length === 0 && <p className="muted">Transcript arrives when the call ends.</p>}
            {d.transcript.map((l, i) => (
              <div key={i} className={`bubble ${l.role}`}>
                <span className="who">
                  {l.role === "agent" ? "Agent" : "Caller"}
                  {l.secondsFromStart !== undefined && <span className="ts"> {Math.floor(l.secondsFromStart)}s</span>}
                </span>
                {l.text}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
