"use client";

import { useEffect, useState } from "react";
import { useProfiles } from "@/components/ProfileProvider";
import { api } from "@/lib/api";

type Hours = Record<string, { open: string; close: string } | null>;
interface Profile {
  id: string;
  name: string;
  industry: string;
  timezone: string;
  agent: { name: string; greeting: string; personality: string; voice: { provider: string; voiceId: string } };
  hours: Hours;
  faqs: { q: string; a: string }[];
  transfer: { label: string; number: string };
  [k: string]: unknown;
}

const DAYS: [string, string][] = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];

export default function ProfilesPage() {
  const { current, refresh } = useProfiles();
  const [p, setP] = useState<Profile | null>(null);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!current) return;
    setStatus(null);
    setPreview(null);
    setDirty(false);
    api(`/api/profiles/${current.id}`).then((r) => {
      setP(r.profile);
      setSynced(r.synced);
    });
  }, [current]);

  if (!p || !current) return <p className="muted">Loading…</p>;

  const edit = (fn: (draft: Profile) => void) => {
    const next = structuredClone(p);
    fn(next);
    setP(next);
    setDirty(true);
  };

  const save = async () => {
    try {
      const r = await api(`/api/profiles/${p.id}`, { method: "PATCH", json: { agent: p.agent, hours: p.hours, faqs: p.faqs } });
      setDirty(false);
      setStatus(
        r.syncError ? { tone: "amber", text: `Saved. Vapi sync failed: ${r.syncError}` } : { tone: "green", text: "Saved. The agent uses the new details on the next call." },
      );
      refresh();
    } catch (e: any) {
      setStatus({ tone: "red", text: e.body?.issues?.join("; ") ?? e.message });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p className="muted">
            {p.industry} · {p.timezone} · transfers go to {p.transfer.label}
          </p>
        </div>
        <div className="row gap">
          <a className="button" href={`/api/profiles/${p.id}/export`}>
            Export JSON
          </a>
          <button
            onClick={async () => {
              try {
                await api(`/api/profiles/${p.id}/sync`, { method: "POST" });
                setSynced(true);
                setStatus({ tone: "green", text: "Synced to Vapi." });
                refresh();
              } catch (e: any) {
                setStatus({ tone: "red", text: e.message });
              }
            }}
          >
            {synced ? "Re-sync to Vapi" : "Sync to Vapi"}
          </button>
          <button className="primary" disabled={!dirty} onClick={save} data-testid="save-profile">
            Save changes
          </button>
        </div>
      </div>
      {status && <div className={`notice ${status.tone}`}>{status.text}</div>}

      <div className="profile-grid">
        <section className="card">
          <h2>Greeting</h2>
          <label>
            Agent name
            <input value={p.agent.name} onChange={(e) => edit((d) => void (d.agent.name = e.target.value))} />
          </label>
          <label>
            First sentence (must say it is an AI assistant)
            <textarea rows={3} value={p.agent.greeting} onChange={(e) => edit((d) => void (d.agent.greeting = e.target.value))} />
          </label>
          {!/\b(AI|artificial intelligence|virtual assistant)\b/i.test(p.agent.greeting) && (
            <p className="muted small">No AI disclosure found, so one will be added automatically before the greeting.</p>
          )}

          <h2 className="mt">Opening hours</h2>
          <table className="hours" data-testid="hours-table">
            <tbody>
              {DAYS.map(([key, label]) => {
                const h = p.hours[key];
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>
                      <label className="inline">
                        <input
                          type="checkbox"
                          checked={!!h}
                          onChange={(e) => edit((d) => void (d.hours[key] = e.target.checked ? { open: "09:00", close: "17:00" } : null))}
                        />
                        Open
                      </label>
                    </td>
                    <td>
                      {h ? (
                        <>
                          <input type="time" value={h.open} data-testid={`open-${key}`} onChange={(e) => edit((d) => void (d.hours[key]!.open = e.target.value))} />
                          {" – "}
                          <input type="time" value={h.close} data-testid={`close-${key}`} onChange={(e) => edit((d) => void (d.hours[key]!.close = e.target.value))} />
                        </>
                      ) : (
                        <span className="muted">Closed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card">
          <div className="row between">
            <h2>FAQs the agent can answer</h2>
            <button className="small-button" data-testid="add-faq" onClick={() => edit((d) => void d.faqs.push({ q: "", a: "" }))}>
              + Add FAQ
            </button>
          </div>
          <div className="faqs">
            {p.faqs.map((f, i) => (
              <div className="faq" key={i}>
                <input placeholder="Question" value={f.q} data-testid={`faq-q-${i}`} onChange={(e) => edit((d) => void (d.faqs[i].q = e.target.value))} />
                <textarea placeholder="Answer" rows={2} value={f.a} data-testid={`faq-a-${i}`} onChange={(e) => edit((d) => void (d.faqs[i].a = e.target.value))} />
                <button className="link-button" onClick={() => edit((d) => void d.faqs.splice(i, 1))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card mt">
        <div className="row between">
          <h2>What gets sent to Vapi</h2>
          <button
            className="small-button"
            onClick={async () => setPreview(preview ? null : JSON.stringify(await api(`/api/profiles/${p.id}/assistant`), null, 2))}
          >
            {preview ? "Hide" : "Show assistant JSON"}
          </button>
        </div>
        <p className="muted small">Generated from this profile: system prompt, tools, AI disclosure and fallbacks. The webhook secret is redacted here.</p>
        {preview && <pre className="code">{preview}</pre>}
      </section>
    </>
  );
}
