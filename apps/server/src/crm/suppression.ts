import type { DB } from "../db/index.js";
import { toE164 } from "../util/phone.js";

export function isSuppressed(db: DB, phone: string | null | undefined): boolean {
  const e164 = toE164(phone);
  if (!e164) return false;
  return !!db.prepare("SELECT 1 FROM suppression WHERE phone_e164 = ?").get(e164);
}

export function addSuppression(db: DB, phone: string, reason: string, source: "dnc_list" | "caller_request" | "admin") {
  const e164 = toE164(phone);
  if (!e164) throw new Error(`Invalid phone number: ${phone}`);
  db.prepare("INSERT INTO suppression (phone_e164, reason, source) VALUES (?, ?, ?) ON CONFLICT(phone_e164) DO NOTHING").run(
    e164,
    reason,
    source,
  );
  return e164;
}

export function listSuppression(db: DB) {
  return db.prepare("SELECT phone_e164 AS phone, reason, source, added_at AS addedAt FROM suppression ORDER BY added_at DESC").all();
}
