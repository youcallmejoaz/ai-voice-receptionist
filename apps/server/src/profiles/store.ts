import type { DB } from "../db/index.js";
import { parseProfile, ProfilePatch } from "./loader.js";
import type { BusinessProfile } from "./schema.js";

export interface StoredProfile {
  profile: BusinessProfile;
  vapiAssistantId: string | null;
  calendarOutage: boolean;
  updatedAt: string;
}

interface Row {
  id: string;
  json: string;
  vapi_assistant_id: string | null;
  calendar_outage: number;
  updated_at: string;
}

function fromRow(r: Row): StoredProfile {
  return {
    profile: parseProfile(JSON.parse(r.json), `db:${r.id}`),
    vapiAssistantId: r.vapi_assistant_id,
    calendarOutage: r.calendar_outage === 1,
    updatedAt: r.updated_at,
  };
}

/** Insert profiles from config files. Existing rows keep their dashboard edits unless `overwrite`. */
export function seedProfiles(db: DB, profiles: BusinessProfile[], overwrite = false) {
  const sql = overwrite
    ? "INSERT INTO profiles (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    : "INSERT INTO profiles (id, json) VALUES (?, ?) ON CONFLICT(id) DO NOTHING";
  const stmt = db.prepare(sql);
  for (const p of profiles) stmt.run(p.id, JSON.stringify(p));
}

export function listProfiles(db: DB): StoredProfile[] {
  return (db.prepare("SELECT * FROM profiles ORDER BY id").all() as Row[]).map(fromRow);
}

export function getProfile(db: DB, id: string): StoredProfile | null {
  const r = db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function findProfileByAssistantId(db: DB, assistantId: string): StoredProfile | null {
  const r = db.prepare("SELECT * FROM profiles WHERE vapi_assistant_id = ?").get(assistantId) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** Merge a partial edit, re-validate the whole profile, then save. Throws ProfileValidationError. */
export function updateProfile(db: DB, id: string, patch: unknown): BusinessProfile {
  const current = getProfile(db, id);
  if (!current) throw new Error(`Unknown profile ${id}`);
  const parsedPatch = ProfilePatch.parse(patch);
  const merged = parseProfile({ ...current.profile, ...parsedPatch, id }, `edit:${id}`);
  db.prepare("UPDATE profiles SET json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(
    JSON.stringify(merged),
    id,
  );
  return merged;
}

export function setAssistantId(db: DB, id: string, assistantId: string) {
  db.prepare("UPDATE profiles SET vapi_assistant_id = ? WHERE id = ?").run(assistantId, id);
}

export function setCalendarOutage(db: DB, id: string, outage: boolean) {
  db.prepare("UPDATE profiles SET calendar_outage = ? WHERE id = ?").run(outage ? 1 : 0, id);
}
