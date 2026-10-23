import { buildAssistant } from "../assistant/build.js";
import { telephonyEnabled, type AppContext } from "../context.js";
import { getProfile, setAssistantId } from "../profiles/store.js";

export function assistantFor(app: AppContext, profileId: string) {
  const stored = getProfile(app.db, profileId);
  if (!stored) throw new Error(`Unknown profile ${profileId}`);
  return buildAssistant(stored.profile, {
    webhookUrl: `${app.cfg.publicBaseUrl}/api/vapi/webhook`,
    webhookSecret: app.cfg.vapiWebhookSecret,
    llmProvider: app.cfg.vapiLlmProvider,
    llmModel: app.cfg.vapiLlmModel,
    telephonyEnabled: telephonyEnabled(app),
  });
}

/** Push the profile's assistant definition to Vapi (create or update). */
export async function syncAssistant(app: AppContext, profileId: string): Promise<string> {
  if (!app.vapi) throw new Error("VAPI_PRIVATE_KEY is not set");
  const stored = getProfile(app.db, profileId)!;
  const { id } = await app.vapi.upsertAssistant(assistantFor(app, profileId), stored.vapiAssistantId);
  setAssistantId(app.db, profileId, id);
  return id;
}
