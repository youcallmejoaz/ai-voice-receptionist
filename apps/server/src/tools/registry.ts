import { z } from "zod";
import { logEvent } from "../db/index.js";
import type { ToolContext, ToolResult } from "./context.js";
import { createLead, createLeadArgs, doNotCallArgs, markDoNotCall, transferArgs, transferToHuman } from "./leads.js";
import {
  bookAppointment,
  bookAppointmentArgs,
  checkAvailability,
  checkAvailabilityArgs,
  requestCallback,
  requestCallbackArgs,
} from "./scheduling.js";

interface ToolDef<S extends z.ZodType> {
  description: string;
  args: S;
  /** What the agent says while the tool runs, so there's no dead air. */
  waitMessage?: string;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolResult>;
}

const def = <S extends z.ZodType>(d: ToolDef<S>) => d;

export const TOOLS = {
  check_availability: def({
    description: "Find open appointment times. Call before offering any time; never invent times.",
    args: checkAvailabilityArgs,
    waitMessage: "Let me check the calendar.",
    run: checkAvailability,
  }),
  book_appointment: def({
    description: "Book a time the caller picked from check_availability. Needs name and phone.",
    args: bookAppointmentArgs,
    waitMessage: "One moment while I book that.",
    run: bookAppointment,
  }),
  request_callback: def({
    description: "Take a callback request when booking isn't possible (calendar down, no suitable time) or the caller prefers a call back.",
    args: requestCallbackArgs,
    run: requestCallback,
  }),
  create_lead: def({
    description: "Save the caller's details and qualification answers to the CRM and check whether they are a fit.",
    args: createLeadArgs,
    run: createLead,
  }),
  transfer_to_human: def({
    description: "Hand the call to a person when the caller asks for one or the situation matches the transfer rules.",
    args: transferArgs,
    run: transferToHuman,
  }),
  mark_do_not_call: def({
    description: "The caller asked not to be called again. Adds their number to the do-not-call list immediately.",
    args: doNotCallArgs,
    run: markDoNotCall,
  }),
} as const;

export type ToolName = keyof typeof TOOLS;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOLS, name);
}

/** JSON Schema for a tool's arguments, in the shape LLM function-calling expects. */
export function toolParameters(name: ToolName): Record<string, unknown> {
  const schema = z.toJSONSchema(TOOLS[name].args, { target: "draft-7" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Validate and run one tool call. Never throws: errors come back as recoverable results. */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolResult> {
  let result: ToolResult;
  if (!isToolName(name)) {
    result = { ok: false, error: "unknown_tool" };
  } else {
    let args: unknown = rawArgs;
    if (typeof rawArgs === "string") {
      try {
        args = JSON.parse(rawArgs || "{}");
      } catch {
        args = null;
      }
    }
    const tool = TOOLS[name] as ToolDef<z.ZodType>;
    const parsed = tool.args.safeParse(args ?? {});
    if (!parsed.success) {
      result = {
        ok: false,
        error: "invalid_arguments",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        say: "Some details were missing or unclear. Ask the caller for the missing details, then try again.",
      };
    } else {
      try {
        result = await tool.run(ctx, parsed.data);
      } catch (e) {
        console.error(`tool ${name} failed`, e);
        result = {
          ok: false,
          error: "internal_error",
          fallback: "offer_transfer",
          say: "Something went wrong on our side. Apologise and offer to take a message or connect them to the team.",
        };
      }
    }
  }
  logEvent(ctx.db, {
    callId: ctx.call?.id,
    profileId: ctx.profile.id,
    kind: "tool",
    name: "invoke",
    detail: { tool: name, ok: result.ok, error: result.error ?? null },
  });
  return result;
}
