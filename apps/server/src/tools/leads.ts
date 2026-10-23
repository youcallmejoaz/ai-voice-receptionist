import { z } from "zod";
import { setCallLead } from "../calls.js";
import { evaluateQualification } from "../crm/qualification.js";
import { getLead, setLeadStatus, upsertLead } from "../crm/leads.js";
import { addSuppression } from "../crm/suppression.js";
import { logEvent } from "../db/index.js";
import { toE164 } from "../util/phone.js";
import type { ToolContext, ToolResult } from "./context.js";
import { sourceOf } from "./scheduling.js";

// ---------------------------------------------------------------- create_lead

export const createLeadArgs = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  interest: z.string().optional().describe("What they want, in a few words"),
  answers: z
    .record(z.string(), z.string())
    .describe("Answers to the qualification questions, keyed by the question's field name, using the suggested values where given"),
});

export async function createLead(ctx: ToolContext, args: z.infer<typeof createLeadArgs>): Promise<ToolResult> {
  const phone = toE164(args.phone) ?? toE164(ctx.customerPhone);
  if (args.phone && !toE164(args.phone)) {
    return { ok: false, error: "invalid_phone", say: "Ask the caller to repeat their phone number digit by digit." };
  }
  const q = evaluateQualification(ctx.profile, args.answers);
  const lead = upsertLead(
    ctx.db,
    {
      profileId: ctx.profile.id,
      name: args.name,
      phone,
      email: args.email,
      interest: args.interest,
      qualification: args.answers,
      qualified: q.qualified,
      notFitReason: q.failedReasons.join("; ") || null,
      source: sourceOf(ctx),
      status: q.qualified === false ? "not_fit" : q.qualified ? "qualified" : "new",
    },
    ctx.call?.lead_id,
  );
  if (ctx.call) setCallLead(ctx.db, ctx.call.id, lead.id);
  const event = q.qualified === false ? "lead_not_fit" : q.qualified ? "lead_qualified" : "lead_incomplete";
  logEvent(ctx.db, { callId: ctx.call?.id, profileId: ctx.profile.id, kind: "tool", name: event, detail: { leadId: lead.id, ...q } });
  await ctx.crm.pushLead(lead, { profileName: ctx.profile.name, event });

  if (q.qualified === false) {
    return { ok: true, qualified: false, reasons: q.failedReasons, say: "Kindly explain why this isn't a fit using the reason, suggest an alternative if there is one, and wrap up." };
  }
  if (q.qualified === null) {
    return { ok: true, qualified: null, missing: q.missing, say: "Ask the remaining questions, then call create_lead again with all answers." };
  }
  return { ok: true, qualified: true, say: "They qualify. Offer to book the appointment now with check_availability." };
}

// ---------------------------------------------------------------- transfer_to_human

export const transferArgs = z.object({
  reason: z.string().describe("Why the caller needs a person, in a few words"),
});

export async function transferToHuman(ctx: ToolContext, args: z.infer<typeof transferArgs>): Promise<ToolResult> {
  const live = ctx.telephonyEnabled && ctx.call?.transport === "phone";
  logEvent(ctx.db, {
    callId: ctx.call?.id,
    profileId: ctx.profile.id,
    kind: "tool",
    name: "transferred",
    detail: { reason: args.reason, target: ctx.profile.transfer.label, mode: live ? "live" : "simulated" },
  });
  if (ctx.call?.lead_id) setLeadStatus(ctx.db, ctx.call.lead_id, "transferred");
  return {
    ok: true,
    mode: live ? "live" : "simulated",
    target: ctx.profile.transfer.label,
    say: live
      ? `Tell the caller you're connecting them to ${ctx.profile.transfer.label} now, then use transferCall.`
      : `Tell the caller you've alerted ${ctx.profile.transfer.label}, who will take over from here, and offer to take a message in the meantime.`,
  };
}

// ---------------------------------------------------------------- mark_do_not_call

export const doNotCallArgs = z.object({
  phone: z.string().optional().describe("Only if the caller gives a number different from the one on file"),
});

export async function markDoNotCall(ctx: ToolContext, args: z.infer<typeof doNotCallArgs>): Promise<ToolResult> {
  const lead = ctx.call?.lead_id ? getLead(ctx.db, ctx.call.lead_id) : null;
  const phone = toE164(args.phone) ?? toE164(ctx.customerPhone) ?? lead?.phone ?? null;
  if (!phone) {
    return { ok: false, error: "phone_required", say: "Ask which phone number should be removed from the call list." };
  }
  addSuppression(ctx.db, phone, "Caller asked not to be called", "caller_request");
  if (lead) setLeadStatus(ctx.db, lead.id, "opted_out");
  else if (ctx.call) {
    const created = upsertLead(ctx.db, { profileId: ctx.profile.id, name: "Unknown caller", phone, source: sourceOf(ctx), status: "opted_out" });
    setCallLead(ctx.db, ctx.call.id, created.id);
  }
  logEvent(ctx.db, { callId: ctx.call?.id, profileId: ctx.profile.id, kind: "tool", name: "opted_out", detail: { phoneLast4: phone.slice(-4) } });
  return { ok: true, say: "Confirm they won't receive any more calls from us, apologise for the interruption, and end the call politely." };
}
