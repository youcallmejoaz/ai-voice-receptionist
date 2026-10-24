"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OutcomeBadge } from "@/components/Badge";
import { useProfiles } from "@/components/ProfileProvider";
import { api, formatWhen } from "@/lib/api";

interface CallRow {
  id: number;
  direction: string;
  transport: string;
  status: string;
  outcome: string | null;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  leadName: string | null;
  hasRecording: number;
}

export default function CallsPage() {
  const { current } = useProfiles();
  const [rows, setRows] = useState<CallRow[] | null>(null);

  useEffect(() => {
    if (!current) return;
    const load = () => api<CallRow[]>(`/api/calls?profileId=${current.id}`).then(setRows).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [current?.id]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Call log</h1>
          <p className="muted">Every call with its outcome and AI summary. Open one for the transcript and recording.</p>
        </div>
      </div>
      <div className="card flush">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Direction</th>
              <th>Caller</th>
              <th>Outcome</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No calls yet. Start one from Live call.
                </td>
              </tr>
            )}
            {rows?.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => (window.location.href = `/calls/${c.id}`)} data-testid={`call-row-${c.id}`}>
                <td className="nowrap">
                  <Link href={`/calls/${c.id}`}>{formatWhen(c.startedAt)}</Link>
                </td>
                <td className="nowrap">
                  {c.direction === "inbound" ? "↙ Inbound" : "↗ Outbound"} <span className="muted small">{c.transport}</span>
                </td>
                <td>{c.leadName ?? <span className="muted">Unknown</span>}</td>
                <td>
                  <OutcomeBadge outcome={c.outcome} />
                </td>
                <td className="summary-cell">{c.summary?.split("\n")[0] ?? <span className="muted">{c.status === "ended" ? "" : "Call in progress…"}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
