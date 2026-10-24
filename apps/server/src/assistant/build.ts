import type { CreateAssistantDTO } from "@vapi-ai/web/dist/api.js";
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
export function buildAssistant(profile: BusinessProfile, opts: AssistantBuildOptions): CreateAssistantDTO {
  const server = { url: opts.webhookUrl, headers: { "x-vapi-secret": opts.webhookSecret } };

  type Tool = NonNullable<NonNullable<CreateAssistantDTO["model"]>["tools"]>[number];
  const tools: Tool[] = (Object.keys(TOOLS) as ToolName[]).map((name) => ({
    type: "function" as const,
    function: { name, description: TOOLS[name].description, parameters: toolParameters(name, profile) as never },
    server,
    ...(TOOLS[name].waitMessage ? { messages: [{ type: "request-start" as const, content: TOOLS[name].waitMessage }] } : {}),
  }));

  tools.push({ type: "endCall" });

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
    // provider/model and voice come from config, so they are validated by Vapi rather than by tsc
    model: {
      provider: opts.llmProvider,
      model: opts.llmModel,
      messages: [{ role: "system", content: buildSystemPrompt(profile) }],
      tools,
    } as CreateAssistantDTO["model"],
    voice: { provider: profile.agent.voice.provider, voiceId: profile.agent.voice.voiceId } as CreateAssistantDTO["voice"],
    transcriber: { provider: "deepgram", model: "nova-3", language: "en" },
    // interruption handling: stop talking as soon as the caller says a word or two
    stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1 },
    maxDurationSeconds: 900,
    endCallMessage: "Thanks for calling. Goodbye!",
    artifactPlan: { recordingEnabled: true, recordingFormat: "mp3" },
    analysisPlan: { summaryPlan: { enabled: true } },
    // serverMessages left at Vapi's default, which includes tool-calls, status-update and end-of-call-report
    server,
    metadata: { profileId: profile.id },
  };
}

