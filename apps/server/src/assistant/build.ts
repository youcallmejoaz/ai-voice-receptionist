import type { BusinessProfile } from "../profiles/schema.js";
import { TOOLS, toolParameters, type ToolName } from "../tools/registry.js";
import { buildSystemPrompt, withDisclosure } from "./prompt.js";

export interface AssistantBuildOptions {
  webhookUrl: string;
  webhookSecret: string;
  llmProvider: string;
  llmModel: string;
  telephonyEnabled: boolean;
}

/**
 * Turn a business profile into a Vapi assistant definition. Every business gets the same tools,
 * fallbacks and safeguards; only the facts differ. The webhook secret lives in this server-side
 * definition only and never reaches the browser.
 */
export function buildAssistant(profile: BusinessProfile, opts: AssistantBuildOptions) {
  const server = { url: opts.webhookUrl, headers: { "x-vapi-secret": opts.webhookSecret } };

  const tools: Record<string, unknown>[] = (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    type: "function",
    function: { name, description: TOOLS[name].description, parameters: toolParameters(name) },
    server,
    ...(TOOLS[name].waitMessage ? { messages: [{ type: "request-start", content: TOOLS[name].waitMessage }] } : {}),
  }));

  if (opts.telephonyEnabled) {
    tools.push({
      type: "transferCall",
      destinations: [
        {
          type: "number",
          number: profile.transfer.number,
          message: `Connecting you to ${profile.transfer.label} now.`,
          description: profile.transfer.label,
        },
      ],
    });
  }

  return {
    name: `${profile.name} receptionist`.slice(0, 40),
    firstMessage: withDisclosure(profile.agent.greeting, profile),
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: opts.llmProvider,
      model: opts.llmModel,
      messages: [{ role: "system", content: buildSystemPrompt(profile) }],
      tools,
    },
    voice: { provider: profile.agent.voice.provider, voiceId: profile.agent.voice.voiceId },
    transcriber: { provider: "deepgram", model: "nova-3", language: "en" },
    // interruption handling: stop talking as soon as the caller says a word or two
    stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1 },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    endCallFunctionEnabled: true,
    endCallMessage: "Thanks for calling. Goodbye!",
    artifactPlan: { recordingEnabled: true },
    analysisPlan: { summaryPlan: { enabled: true } },
    server,
    serverMessages: ["end-of-call-report", "status-update", "tool-calls"],
    metadata: { profileId: profile.id },
  };
}

export type VapiAssistant = ReturnType<typeof buildAssistant>;
