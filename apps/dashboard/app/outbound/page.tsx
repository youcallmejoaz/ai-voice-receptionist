"use client";

import { useCallback, useEffect, useState } from "react";
import { OutcomeBadge } from "@/components/Badge";
import { CallPanel } from "@/components/CallPanel";
import { useProfiles } from "@/components/ProfileProvider";
import { api } from "@/lib/api";

interface Job {
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
interface Ev {
  id: number;
  name: string;
  detail: any;
  ts: string;
  kind: string;
}

const mask = (p: string | null) => (p ? `•••${p.slice(-4)}` : "—");

function logLine(e: Ev) {
  const d = e.detail;
  switch (e.name) {
    case "skipped":
      return `SKIPPED ${d.lead} (${d.phone}): ${d.message}`;
    case "ready":
      return `READY   ${d.lead} (${d.phone}): consent ✓ · not on do-not-call list ✓`;
    case "dialled":
      return `DIALLED ${d.lead} (${d.phone})`;
    case "sandbox_call":
      return `CALLING ${d.lead} (browser sandbox)`;
    case "csv_imported":
      return `IMPORTED ${d.rows} leads${d.errors?.length ? ` · ${d.errors.length} warnings` : ""}`;
    default:
      return e.name;
  }
}

async function readFile(input: HTMLInputElement) {
  const f = input.files?.[0];
  input.value = "";
  return f ? f.text() : null;
}

export default function OutboundPage() {
  const { current } = useProfiles();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [log, setLog] = useState<Ev[]>([]);
  const [dnc, setDnc] = useState<{ phone: string; reason: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState<Job | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!current) return;
    const [j, ev, s] = await Promise.all([
      api<Job[]>(`/api/outbound?profileId=${current.id}`),
      api<Ev[]>(`/api/events?profileId=${current.id}`),
      api<{ phone: string; reason: string }[]>("/api/suppression"),
    ]);
    setJobs(j);
    setLog(ev.filter((e) => e.kind === "outbound").reverse());
    setDnc(s);
  }, [current]);

  useEffect(() => {
    api("/api/config").then((c) => setPublicKey(c.vapiPublicKey)).catch(() => {});
  }, []);
  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!current) return <p className="muted">Loading…</p>;

  const upload = async (url: string, input: HTMLInputElement) => {
    const text = await readFile(input);
    if (!text) return;
    try {
      const r = await api(url, { method: "POST", body: text, headers: { "content-type": "text/csv" } });
      setMessage(r.errors?.length ? `Imported with warnings: ${r.errors.join("; ")}` : `Imported ${r.imported ?? r.added} rows`);
    } catch (e: any) {
      setMessage(e.body?.errors?.join("; ") ?? e.message);
    }
    load();
  };

  const counts = {
    total: jobs.length,
    consent: jobs.filter((j) => j.consent).length,
    skipped: jobs.filter((j) => j.status === "skipped").length,
    ready: jobs.filter((j) => j.status === "ready").length,
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Outbound follow-up</h1>
          <p className="muted">
            Upload a lead list with a consent column. Only leads with consent who are not on the do-not-call list are called, between 8am and 9pm.
            Test numbers only.
          </p>
        </div>
      </div>
      <div className="row wrap gap">
        <label className="button">
          Upload leads CSV
          <input type="file" accept=".csv,text/csv" hidden data-testid="leads-upload" onChange={(e) => upload(`/api/outbound/import?profileId=${current.id}`, e.target)} />
        </label>
        <label className="button">
          Upload do-not-call list
          <input type="file" accept=".csv,text/csv" hidden data-testid="dnc-upload" onChange={(e) => upload("/api/suppression/import", e.target)} />
        </label>
        <button
          className="primary"
          data-testid="run-list"
          disabled={!jobs.some((j) => j.status === "queued")}
          onClick={async () => {
            const r = await api("/api/outbound/run", { method: "POST", json: { profileId: current.id } });
            setMessage(`Checked ${r.checked}: ${r.skipped} skipped, ${r.ready + r.dialled} cleared to call`);
            load();
          }}
        >
          Run consent checks
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>

      {active && (
        <div className="card inset">
          <div className="row between">
            <h2>Outbound call to {active.name}</h2>
            <button className="link-button" onClick={() => setActive(null)}>
              Close
            </button>
          </div>
          <CallPanel
            publicKey={publicKey}
            profileId={current.id}
            title={`Outbound · ${active.interest ?? "follow-up"}`}
            startLabel={`Call ${active.name.split(" ")[0]}`}
            prepare={() => api(`/api/outbound/${active.id}/start`, { method: "POST" })}
          />
        </div>
      )}

      <div className="outbound-grid">
        <div className="card flush">
          <div className="card-head">
            <h2>Lead list</h2>
            <span className="muted small">
              {counts.total} leads · {counts.consent} with consent · {counts.skipped} skipped · {counts.ready} ready
            </span>
          </div>
          <table className="table" data-testid="outbound-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Phone</th>
                <th>Consent</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Upload seed/leads.csv to start.
                  </td>
                </tr>
              )}
              {jobs.map((j) => (
                <tr key={j.id} className={j.status === "skipped" ? "dim" : ""}>
                  <td>
                    {j.name}
                    <div className="muted small">{j.interest}</div>
                  </td>
                  <td className="mono nowrap">{mask(j.phone)}</td>
                  <td>{j.consent ? <span className="badge green">Yes</span> : <span className="badge red">No</span>}</td>
                  <td>
                    {j.status === "skipped" ? (
                      <span className="skip">Skipped: {j.skipReason}</span>
                    ) : j.outcome ? (
                      <OutcomeBadge outcome={j.outcome} />
                    ) : (
                      <span className="badge grey">{j.status}</span>
                    )}
                  </td>
                  <td>
                    {j.status === "ready" && (
                      <button className="small-button" onClick={() => setActive(j)} data-testid={`call-${j.leadId}`}>
                        Call
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Consent log</h2>
            <pre className="log" data-testid="consent-log">
              {log.length ? log.map((e) => `${new Date(e.ts).toLocaleTimeString([], { hour12: false })}  ${logLine(e)}`).join("\n") : "Nothing yet."}
            </pre>
          </div>
          <div className="card">
            <h2>Do-not-call list</h2>
            {dnc.length === 0 ? (
              <p className="muted small">Empty.</p>
            ) : (
              <ul className="plain">
                {dnc.map((d) => (
                  <li key={d.phone}>
                    <span className="mono">{mask(d.phone)}</span> <span className="muted small">{d.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
