import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import type { AppConfig } from "../src/config.js";
import { createContext, type AppContext } from "../src/context.js";
import { openDb } from "../src/db/index.js";
import { RecordingStore } from "../src/recordings/store.js";
import type { CallSummary, Summarizer, SummaryInput } from "../src/summary/index.js";

export const REPO = path.resolve(import.meta.dirname, "../../..");
export const SECRET = "test-webhook-secret";
export const PASSWORD = "test-password";

/** Monday 26 Oct 2026, 09:00 in Chicago (14:00 UTC), 08:00 in Denver. */
export const MONDAY_9AM_CHICAGO = new Date("2026-10-26T14:00:00Z");

export class FakeSummarizer implements Summarizer {
  calls: SummaryInput[] = [];
  async summarize(input: SummaryInput): Promise<CallSummary> {
    this.calls.push(input);
    return { summary: "Test summary.", outcome_guess: "Qualified", caller_name: null, caller_need: null, follow_up: null };
  }
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avr-"));
  return {
    port: 0,
    nodeEnv: "test",
    repoRoot: REPO,
    publicBaseUrl: "https://receptionist.test",
    databasePath: ":memory:",
    recordingsDir: path.join(tmp, "recordings"),
    profilesDir: path.join(REPO, "profiles"),
    adminPassword: PASSWORD,
    sessionSecret: "test-session-secret",
    vapiPrivateKey: "",
    vapiPublicKey: "",
    vapiWebhookSecret: SECRET,
    vapiPhoneNumberId: "",
    vapiLlmProvider: "anthropic",
    vapiLlmModel: "claude-haiku-5-5",
    anthropicApiKey: "",
    summaryModel: "claude-haiku-5-5",
    calendarProvider: "mock",
    googleClientId: "",
    googleClientSecret: "",
    googleRefreshToken: "",
    crmWebhookUrl: "",
    ...overrides,
  };
}

export async function makeTestApp(opts: { now?: Date; cfg?: Partial<AppConfig>; ctx?: Partial<AppContext> } = {}) {
  const cfg = testConfig(opts.cfg);
  const now = opts.now ?? MONDAY_9AM_CHICAGO;
  const summarizer = new FakeSummarizer();
  const ctx = createContext(cfg, {
    db: openDb(":memory:"),
    summarizer,
    now: () => now,
    recordings: new RecordingStore(cfg.recordingsDir, (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch),
    ...opts.ctx,
  });
  await bootstrap(ctx, { sync: false });
  const app = createApp(ctx);
  return { ctx, app, summarizer, http: request(app) };
}

/** Call a tool through the HTTP tool endpoint. */
export async function tool(http: ReturnType<typeof request>, profileId: string, name: string, args: unknown, sessionId?: string) {
  const res = await http.post(`/api/vapi/tools/${name}`).set("x-vapi-secret", SECRET).send({ profileId, args, sessionId });
  if (res.status !== 200) throw new Error(`tool ${name} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { sessionId: string; result: Record<string, any> };
}

export async function login(http: ReturnType<typeof request>) {
  const res = await http.post("/api/auth/login").send({ password: PASSWORD });
  return res.headers["set-cookie"] as unknown as string[];
}
