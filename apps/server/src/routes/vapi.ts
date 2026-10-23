import { Router } from "express";
import { z } from "zod";
import { requireVapiSecret } from "../auth.js";
import { createCall, getCallBySession } from "../calls.js";
import type { AppContext } from "../context.js";
import { getProfile } from "../profiles/store.js";
import { runTool } from "../tools/registry.js";
import { handleServerMessage, toolContext } from "../vapi/webhook.js";

export function vapiRoutes(app: AppContext) {
  const r = Router();
  r.use(requireVapiSecret(app.cfg));

  /** Single server URL for every Vapi server message (tool calls, status, end-of-call report). */
  r.post("/webhook", async (req, res) => {
    const type = req.body?.message?.type;
    if (type === "end-of-call-report") {
      // acknowledge first; summarising and downloading the recording can take a while
      res.json({});
      await handleServerMessage(app, req.body).catch((e) => console.error("end-of-call processing failed", e));
      return;
    }
    res.json(await handleServerMessage(app, req.body));
  });

  /**
   * Direct tool endpoint (same secret): run any tool against a profile without a live call.
   * Used by the test-suite and handy for curl debugging.
   */
  r.post("/tools/:name", async (req, res) => {
    const body = z
      .object({ profileId: z.string(), sessionId: z.string().optional(), args: z.unknown().optional(), customerPhone: z.string().optional() })
      .safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.issues });
    const stored = getProfile(app.db, body.data.profileId);
    if (!stored) return void res.status(404).json({ error: "unknown profile" });
    const call =
      (body.data.sessionId && getCallBySession(app.db, body.data.sessionId)) ||
      createCall(app.db, { profileId: stored.profile.id, direction: "inbound", transport: "web" });
    const ctx = toolContext(app, { call, profile: stored.profile }, body.data.customerPhone ?? null);
    res.json({ sessionId: call.session_id, result: await runTool(ctx, req.params.name, body.data.args ?? {}) });
  });

  return r;
}
