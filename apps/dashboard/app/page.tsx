"use client";

import { useEffect, useState } from "react";
import { CallPanel } from "@/components/CallPanel";
import { useProfiles } from "@/components/ProfileProvider";
import { api } from "@/lib/api";

interface Config {
  vapiPublicKey: string | null;
  vapiConfigured: boolean;
  telephonyEnabled: boolean;
  calendarProvider: string;
  crm: string;
  claudeSummaries: boolean;
}

export default function LivePage() {
  const { current, refresh } = useProfiles();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    api<Config>("/api/config").then(setCfg).catch(() => {});
  }, []);
  useEffect(() => setOutage(Boolean(current?.calendarOutage)), [current]);

  if (!current) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Talk to {current.agentName}</h1>
          <p className="muted">
            A real call to the {current.name} assistant in your browser. Allow the microphone when asked. The agent introduces itself as an AI
            assistant.
          </p>
        </div>
        <label className="toggle" title="Makes the calendar adapter fail so you can hear the callback fallback">
          <input
            type="checkbox"
            checked={outage}
            data-testid="outage-toggle"
            onChange={async (e) => {
              setOutage(e.target.checked);
              await api(`/api/profiles/${current.id}/outage`, { method: "POST", json: { on: e.target.checked } });
              refresh();
            }}
          />
          Simulate calendar outage
        </label>
      </div>
      {cfg && (!cfg.vapiPublicKey || !current.synced) && (
        <div className="notice amber">
          {!cfg.vapiPublicKey ? "Set VAPI_PUBLIC_KEY on the server to enable web calls. " : ""}
          {!current.synced ? "This profile is not synced to Vapi yet: open Business profile and press Sync." : ""}
        </div>
      )}
      <CallPanel
        key={current.id}
        publicKey={cfg?.vapiPublicKey ?? null}
        profileId={current.id}
        title={`Inbound call · ${current.name}`}
        prepare={() => api("/api/calls/web", { method: "POST", json: { profileId: current.id } })}
      />
      {cfg && (
        <p className="muted small footer-note">
          Calendar: {cfg.calendarProvider} · CRM: {cfg.crm} · Summaries: {cfg.claudeSummaries ? "Claude" : "platform fallback"} · Phone:{" "}
          {cfg.telephonyEnabled ? "enabled" : "web calls only"}
        </p>
      )}
    </>
  );
}
