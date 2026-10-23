import type { CalendarAdapter } from "./calendar/adapter.js";
import { GoogleCalendar } from "./calendar/google.js";
import { MockCalendar } from "./calendar/mock.js";
import type { AppConfig } from "./config.js";
import { LocalCrm, WebhookCrm, type CrmAdapter } from "./crm/adapter.js";
import { openDb, type DB } from "./db/index.js";
import { RecordingStore } from "./recordings/store.js";
import { ClaudeSummarizer, ResilientSummarizer, type Summarizer } from "./summary/index.js";
import { VapiClient } from "./vapi/client.js";

/** Everything request handlers need, built once at startup and swapped for fakes in tests. */
export interface AppContext {
  cfg: AppConfig;
  db: DB;
  calendar: CalendarAdapter;
  mockCalendar: MockCalendar;
  crm: CrmAdapter;
  summarizer: Summarizer;
  recordings: RecordingStore;
  vapi: VapiClient | null;
  now: () => Date;
}

export function createContext(cfg: AppConfig, overrides: Partial<AppContext> = {}): AppContext {
  const db = overrides.db ?? openDb(cfg.databasePath);
  const mockCalendar = new MockCalendar(db);
  const calendar =
    cfg.calendarProvider === "google"
      ? new GoogleCalendar({ clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret, refreshToken: cfg.googleRefreshToken })
      : mockCalendar;
  return {
    cfg,
    db,
    calendar,
    mockCalendar,
    crm: cfg.crmWebhookUrl ? new WebhookCrm(db, cfg.crmWebhookUrl) : new LocalCrm(db),
    summarizer: new ResilientSummarizer(cfg.anthropicApiKey ? new ClaudeSummarizer(cfg.anthropicApiKey, cfg.summaryModel) : null),
    recordings: new RecordingStore(cfg.recordingsDir),
    vapi: cfg.vapiPrivateKey ? new VapiClient(cfg.vapiPrivateKey) : null,
    now: () => new Date(),
    ...overrides,
  };
}

export function telephonyEnabled(ctx: AppContext) {
  return Boolean(ctx.cfg.vapiPhoneNumberId && ctx.vapi);
}
