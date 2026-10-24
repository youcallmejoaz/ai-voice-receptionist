"use client";

import { useEffect, useState } from "react";
import { useProfiles } from "@/components/ProfileProvider";
import { api, formatWhen } from "@/lib/api";

interface Lead {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  interest: string | null;
  qualified: boolean | null;
  notFitReason: string | null;
  consent: boolean;
  source: string;
  status: string;
  crmPushedAt: string | null;
  updatedAt: string;
}

const STATUS_TONE: Record<string, string> = {
  booked: "green",
  qualified: "green",
  callback_requested: "amber",
  transferred: "blue",
  not_fit: "grey",
  opted_out: "red",
  new: "grey",
};

export default function LeadsPage() {
  const { current } = useProfiles();
  const [rows, setRows] = useState<Lead[] | null>(null);

  useEffect(() => {
    if (!current) return;
    const load = () => api<Lead[]>(`/api/leads?profileId=${current.id}`).then(setRows).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [current?.id]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>CRM leads</h1>
          <p className="muted">Leads the agent created or updated. Each one is also sent to the CRM webhook when configured.</p>
        </div>
      </div>
      <div className="card flush">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Interest</th>
              <th>Status</th>
              <th>Source</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No leads yet.
                </td>
              </tr>
            )}
            {rows?.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.name}
                  {l.email && <div className="muted small">{l.email}</div>}
                </td>
                <td className="nowrap mono">{l.phone ?? "—"}</td>
                <td>
                  {l.interest ?? "—"}
                  {l.notFitReason && <div className="muted small">{l.notFitReason}</div>}
                </td>
                <td>
                  <span className={`badge ${STATUS_TONE[l.status] ?? "grey"}`}>{l.status.replace(/_/g, " ")}</span>
                </td>
                <td className="small">{l.source.replace(/_/g, " ")}</td>
                <td className="nowrap small">{formatWhen(l.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
