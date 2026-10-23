import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { BusinessProfile } from "../profiles/schema.js";

export interface TranscriptLine {
  role: "agent" | "caller" | "tool";
  text: string;
  secondsFromStart?: number;
}

export interface SummaryInput {
  profile: BusinessProfile;
  direction: "inbound" | "outbound";
  transcript: TranscriptLine[];
  toolEvents: string[];
  platformSummary?: string | null;
}

export const SummarySchema = z.object({
  summary: z.string().describe("2-4 sentences for the business owner: who called, what they wanted, what happened, next step"),
  outcome_guess: z.enum(["Qualified", "NotFit", "Incomplete"]),
  caller_name: z.string().nullable(),
  caller_need: z.string().nullable(),
  follow_up: z.string().nullable().describe("Concrete action the team should take, or null"),
});
export type CallSummary = z.infer<typeof SummarySchema>;

export interface Summarizer {
  summarize(input: SummaryInput): Promise<CallSummary>;
}

function transcriptText(lines: TranscriptLine[]) {
  return lines
    .filter((l) => l.role !== "tool")
    .map((l) => `${l.role === "agent" ? "Agent" : "Caller"}: ${l.text}`)
    .join("\n");
}

/** Post-call summary with Claude, constrained to a JSON schema so the dashboard can rely on fields. */
export class ClaudeSummarizer implements Summarizer {
  private readonly client: Anthropic;
  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async summarize(input: SummaryInput): Promise<CallSummary> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2000,
      output_config: { format: zodOutputFormat(SummarySchema), effort: "low" },
      system:
        "You write call summaries for small business owners. Be factual and brief. Only use what is in the transcript and tool events; never guess phone numbers or emails.",
      messages: [
        {
          role: "user",
          content: `Business: ${input.profile.name} (${input.profile.industry})
Direction: ${input.direction}
Tool events during the call: ${input.toolEvents.join(", ") || "none"}

Transcript:
${transcriptText(input.transcript) || "(empty)"}

outcome_guess: Qualified if the caller fits and wants the service, NotFit if they clearly don't fit, Incomplete if the call ended before that was clear.`,
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return new FallbackSummarizer().summarize(input);
    }
    return response.parsed_output;
  }
}

/** Used without an Anthropic key, or if Claude is unavailable: the platform's own summary or a plain heuristic. */
export class FallbackSummarizer implements Summarizer {
  async summarize(input: SummaryInput): Promise<CallSummary> {
    const firstCallerLine = input.transcript.find((l) => l.role === "caller")?.text ?? null;
    return {
      summary:
        input.platformSummary?.trim() ||
        `${input.direction === "inbound" ? "Inbound" : "Outbound"} call with ${input.transcript.length} turns. ${firstCallerLine ? `Caller opened with: "${firstCallerLine}"` : "No caller speech captured."}`,
      outcome_guess: "Incomplete",
      caller_name: null,
      caller_need: firstCallerLine,
      follow_up: null,
    };
  }
}

/** Claude first; any failure falls back so a summary outage never loses the call record. */
export class ResilientSummarizer implements Summarizer {
  constructor(private readonly primary: Summarizer | null) {}
  async summarize(input: SummaryInput): Promise<CallSummary> {
    if (this.primary) {
      try {
        return await this.primary.summarize(input);
      } catch (e) {
        console.error("summary failed, using fallback", (e as Error).message);
      }
    }
    return new FallbackSummarizer().summarize(input);
  }
}
