import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  repoRoot: string;
  publicBaseUrl: string;
  databasePath: string;
  recordingsDir: string;
  profilesDir: string;
  adminPassword: string;
  sessionSecret: string;
  vapiPrivateKey: string;
  vapiPublicKey: string;
  vapiWebhookSecret: string;
  vapiPhoneNumberId: string;
  vapiLlmProvider: string;
  vapiLlmModel: string;
  anthropicApiKey: string;
  summaryModel: string;
  calendarProvider: "mock" | "google";
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  crmWebhookUrl: string;
}

export function loadConfig(): AppConfig {
  const nodeEnv = env("NODE_ENV", "development");
  const cfg: AppConfig = {
    port: Number(env("PORT", "3000")),
    nodeEnv,
    repoRoot,
    publicBaseUrl: env("PUBLIC_BASE_URL", "http://localhost:3000").replace(/\/$/, ""),
    databasePath: path.resolve(repoRoot, env("DATABASE_PATH", "./data/receptionist.db")),
    recordingsDir: path.resolve(repoRoot, env("RECORDINGS_DIR", "./data/recordings")),
    profilesDir: path.resolve(repoRoot, env("PROFILES_DIR", "./profiles")),
    adminPassword: env("ADMIN_PASSWORD"),
    sessionSecret: env("SESSION_SECRET"),
    vapiPrivateKey: env("VAPI_PRIVATE_KEY"),
    vapiPublicKey: env("VAPI_PUBLIC_KEY"),
    vapiWebhookSecret: env("VAPI_WEBHOOK_SECRET"),
    vapiPhoneNumberId: env("VAPI_PHONE_NUMBER_ID"),
    vapiLlmProvider: env("VAPI_LLM_PROVIDER", "anthropic"),
    vapiLlmModel: env("VAPI_LLM_MODEL", "claude-haiku-5-5"),
    anthropicApiKey: env("ANTHROPIC_API_KEY"),
    summaryModel: env("SUMMARY_MODEL", "claude-haiku-5-5"),
    calendarProvider: env("CALENDAR_PROVIDER", "mock") === "google" ? "google" : "mock",
    googleClientId: env("GOOGLE_CLIENT_ID"),
    googleClientSecret: env("GOOGLE_CLIENT_SECRET"),
    googleRefreshToken: env("GOOGLE_REFRESH_TOKEN"),
    crmWebhookUrl: env("CRM_WEBHOOK_URL"),
  };
  if (nodeEnv === "production") {
    const missing = (["adminPassword", "sessionSecret", "vapiWebhookSecret"] as const).filter((k) => !cfg[k]);
    if (missing.length) throw new Error(`Missing required config in production: ${missing.join(", ")}`);
  }
  return cfg;
}
