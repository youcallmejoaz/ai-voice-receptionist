import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;

const schema = fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec(schema);
  return db;
}

export function logEvent(
  db: DB,
  e: { callId?: number | null; profileId?: string | null; kind: "tool" | "outbound" | "system"; name: string; detail?: unknown },
) {
  db.prepare("INSERT INTO event_log (call_id, profile_id, kind, name, detail) VALUES (?, ?, ?, ?, ?)").run(
    e.callId ?? null,
    e.profileId ?? null,
    e.kind,
    e.name,
    JSON.stringify(e.detail ?? {}),
  );
}
