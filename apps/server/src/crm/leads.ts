import type { DB } from "../db/index.js";

export interface Lead {
  id: number;
  profileId: string;
  name: string;
  phone: string | null;
  email: string | null;
  interest: string | null;
  qualification: Record<string, string>;
  qualified: boolean | null;
  notFitReason: string | null;
  consent: boolean;
  source: string;
  status: string;
  crmPushedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: number;
  profile_id: string;
  name: string;
  phone_e164: string | null;
  email: string | null;
  interest: string | null;
  qualification_json: string;
  qualified: number | null;
  not_fit_reason: string | null;
  consent: number;
  source: string;
  status: string;
  crm_pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

const toLead = (r: Row): Lead => ({
  id: r.id,
  profileId: r.profile_id,
  name: r.name,
  phone: r.phone_e164,
  email: r.email,
  interest: r.interest,
  qualification: JSON.parse(r.qualification_json),
  qualified: r.qualified === null ? null : r.qualified === 1,
  notFitReason: r.not_fit_reason,
  consent: r.consent === 1,
  source: r.source,
  status: r.status,
  crmPushedAt: r.crm_pushed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function getLead(db: DB, id: number): Lead | null {
  const r = db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as Row | undefined;
  return r ? toLead(r) : null;
}

export function findLeadByPhone(db: DB, profileId: string, phone: string): Lead | null {
  const r = db
    .prepare("SELECT * FROM leads WHERE profile_id = ? AND phone_e164 = ? ORDER BY id DESC LIMIT 1")
    .get(profileId, phone) as Row | undefined;
  return r ? toLead(r) : null;
}

export function listLeads(db: DB, profileId: string): Lead[] {
  return (db.prepare("SELECT * FROM leads WHERE profile_id = ? ORDER BY updated_at DESC").all(profileId) as Row[]).map(toLead);
}

export interface LeadInput {
  profileId: string;
  name: string;
  phone: string | null;
  email?: string | null;
  interest?: string | null;
  qualification?: Record<string, string>;
  qualified?: boolean | null;
  notFitReason?: string | null;
  consent?: boolean;
  source: string;
  status?: string;
}

/** Create a lead, or update the existing one with the same phone number for this business. */
export function upsertLead(db: DB, input: LeadInput, existingId?: number | null): Lead {
  const existing =
    (existingId ? getLead(db, existingId) : null) ?? (input.phone ? findLeadByPhone(db, input.profileId, input.phone) : null);
  if (existing) {
    const qualification = { ...existing.qualification, ...(input.qualification ?? {}) };
    db.prepare(
      `UPDATE leads SET name = ?, phone_e164 = COALESCE(?, phone_e164), email = COALESCE(?, email), interest = COALESCE(?, interest),
         qualification_json = ?, qualified = COALESCE(?, qualified), not_fit_reason = COALESCE(?, not_fit_reason),
         status = COALESCE(?, status), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    ).run(
      input.name || existing.name,
      input.phone,
      input.email ?? null,
      input.interest ?? null,
      JSON.stringify(qualification),
      input.qualified === undefined || input.qualified === null ? null : input.qualified ? 1 : 0,
      input.notFitReason ?? null,
      input.status ?? null,
      existing.id,
    );
    return getLead(db, existing.id)!;
  }
  const res = db
    .prepare(
      `INSERT INTO leads (profile_id, name, phone_e164, email, interest, qualification_json, qualified, not_fit_reason, consent, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.profileId,
      input.name,
      input.phone,
      input.email ?? null,
      input.interest ?? null,
      JSON.stringify(input.qualification ?? {}),
      input.qualified === undefined || input.qualified === null ? null : input.qualified ? 1 : 0,
      input.notFitReason ?? null,
      input.consent ? 1 : 0,
      input.source,
      input.status ?? "new",
    );
  return getLead(db, Number(res.lastInsertRowid))!;
}

export function setLeadStatus(db: DB, id: number, status: string) {
  db.prepare("UPDATE leads SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, id);
}
