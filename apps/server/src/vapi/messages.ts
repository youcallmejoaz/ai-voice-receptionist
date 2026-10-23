import { z } from "zod";

/**
 * The subset of Vapi server messages we rely on. Parsing is permissive (passthrough) so new
 * platform fields never break the webhook; we only insist on what we actually read.
 */
const VapiCall = z
  .object({
    id: z.string(),
    type: z.string().optional(), // webCall | inboundPhoneCall | outboundPhoneCall
    assistantId: z.string().nullish(),
    customer: z.object({ number: z.string().nullish() }).passthrough().nullish(),
    assistantOverrides: z
      .object({ variableValues: z.record(z.string(), z.unknown()).nullish(), metadata: z.record(z.string(), z.unknown()).nullish() })
      .passthrough()
      .nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

const ToolCall = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() }),
});

const ArtifactMessage = z
  .object({
    role: z.string(),
    message: z.string().optional(),
    secondsFromStart: z.number().optional(),
  })
  .passthrough();

export const VapiServerMessage = z.object({
  message: z
    .object({
      type: z.string(),
      call: VapiCall.nullish(),
      status: z.string().optional(),
      toolCallList: z.array(ToolCall).optional(),
      endedReason: z.string().optional(),
      artifact: z
        .object({
          messages: z.array(ArtifactMessage).optional(),
          transcript: z.string().optional(),
          recordingUrl: z.string().nullish(),
          recording: z.object({ mono: z.object({ combinedUrl: z.string().nullish() }).passthrough().nullish() }).passthrough().nullish(),
        })
        .passthrough()
        .optional(),
      analysis: z.object({ summary: z.string().nullish() }).passthrough().optional(),
      recordingUrl: z.string().nullish(),
      summary: z.string().nullish(),
    })
    .passthrough(),
});

export type VapiServerMessage = z.infer<typeof VapiServerMessage>["message"];
export type VapiCallInfo = z.infer<typeof VapiCall>;
