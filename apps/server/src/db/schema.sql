PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id                TEXT PRIMARY KEY,
  json              TEXT NOT NULL,
  vapi_assistant_id TEXT,
  calendar_outage   INTEGER NOT NULL DEFAULT 0,   -- demo switch: make the calendar adapter fail
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id         TEXT NOT NULL REFERENCES profiles(id),
  name               TEXT NOT NULL,
  phone_e164         TEXT,
  email              TEXT,
  interest           TEXT,
  qualification_json TEXT NOT NULL DEFAULT '{}',
  qualified          INTEGER,                      -- 1 yes, 0 not a fit, NULL not assessed
  not_fit_reason     TEXT,
  consent            INTEGER NOT NULL DEFAULT 0,   -- outbound consent (1 = may call)
  source             TEXT NOT NULL,                -- inbound_call | outbound_call | csv_import
  status             TEXT NOT NULL DEFAULT 'new',  -- new | qualified | not_fit | booked | callback_requested | transferred | opted_out
  crm_pushed_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS leads_profile ON leads(profile_id);
CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone_e164);

CREATE TABLE IF NOT EXISTS calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL UNIQUE,            -- ours, created before the call starts
  vapi_call_id    TEXT UNIQUE,
  profile_id      TEXT NOT NULL REFERENCES profiles(id),
  direction       TEXT NOT NULL,                   -- inbound | outbound
  transport       TEXT NOT NULL DEFAULT 'web',     -- web | phone
  lead_id         INTEGER REFERENCES leads(id),
  status          TEXT NOT NULL DEFAULT 'created', -- created | in_progress | ended
  outcome         TEXT,                            -- Booked | Qualified | NotFit | Transferred | OptOut | Callback | Incomplete
  summary         TEXT,
  transcript_json TEXT,
  ended_reason    TEXT,
  recording_path  TEXT,                            -- private, relative to RECORDINGS_DIR
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at        TEXT
);
CREATE INDEX IF NOT EXISTS calls_profile ON calls(profile_id, started_at);

CREATE TABLE IF NOT EXISTS slots (
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  start_utc  TEXT NOT NULL,
  end_utc    TEXT NOT NULL,
  booked     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, start_utc)
);

CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id   TEXT NOT NULL REFERENCES profiles(id),
  lead_id      INTEGER REFERENCES leads(id),
  call_id      INTEGER REFERENCES calls(id),
  service      TEXT NOT NULL,
  start_utc    TEXT NOT NULL,
  end_utc      TEXT NOT NULL,
  calendar_ref TEXT,
  status       TEXT NOT NULL DEFAULT 'confirmed',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS suppression (
  phone_e164 TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  source     TEXT NOT NULL,                        -- dnc_list | caller_request | admin
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS outbound_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  TEXT NOT NULL REFERENCES profiles(id),
  lead_id     INTEGER NOT NULL REFERENCES leads(id),
  status      TEXT NOT NULL DEFAULT 'queued',      -- queued | skipped | ready | calling | called | failed
  skip_reason TEXT,
  call_id     INTEGER REFERENCES calls(id),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id    INTEGER REFERENCES calls(id),
  profile_id TEXT,
  kind       TEXT NOT NULL,                        -- tool | outbound | system
  name       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  ts         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS event_log_call ON event_log(call_id);
