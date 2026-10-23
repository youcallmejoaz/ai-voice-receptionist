import { describe, expect, it } from "vitest";
import { getCallBySession } from "../src/calls.js";
import { login, makeTestApp, SECRET } from "./helpers.js";

const DENTAL = "bright-smile-dental";

async function prepareWebCall(t: Awaited<ReturnType<typeof makeTestApp>>) {
  t.ctx.db.prepare("UPDATE profiles SET vapi_assistant_id = 'asst_dental' WHERE id = ?").run(DENTAL);
  const cookie = await login(t.http);
  const res = await t.http.post("/api/calls/web").set("Cookie", cookie).send({ profileId: DENTAL });
  expect(res.status).toBe(200);
  return res.body as { sessionId: string; assistantOverrides: { variableValues: Record<string, string> } };
}

function vapiCall(sessionId: string, id = "vapi-call-1") {
  return { id, type: "webCall", assistantId: "asst_dental", assistantOverrides: { variableValues: { sessionId } } };
}

describe("Vapi webhook", () => {
  it("answers tool-calls in Vapi's results format and links the Vapi call to our session", async () => {
    const t = await makeTestApp();
    const prep = await prepareWebCall(t);
    expect(prep.assistantOverrides.variableValues.sessionId).toBe(prep.sessionId);

    const res = await t.http
      .post("/api/vapi/webhook")
      .set("x-vapi-secret", SECRET)
      .send({
        message: {
          type: "tool-calls",
          call: vapiCall(prep.sessionId),
          toolCallList: [{ id: "tc_1", type: "function", function: { name: "check_availability", arguments: { service_id: "cleaning" } } }],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].toolCallId).toBe("tc_1");
    expect(JSON.parse(res.body.results[0].result).ok).toBe(true);
    expect(getCallBySession(t.ctx.db, prep.sessionId)!.vapi_call_id).toBe("vapi-call-1");
  });

  it("accepts tool arguments as a JSON string", async () => {
    const t = await makeTestApp();
    const prep = await prepareWebCall(t);
    const res = await t.http
      .post("/api/vapi/webhook")
      .set("x-vapi-secret", SECRET)
      .send({
        message: {
          type: "tool-calls",
          call: vapiCall(prep.sessionId),
          toolCallList: [{ id: "tc_2", function: { name: "transfer_to_human", arguments: '{"reason":"wants a person"}' } }],
        },
      });
    expect(JSON.parse(res.body.results[0].result).mode).toBe("simulated");
  });

  it("creates a call record for an inbound phone call it has not seen, matched by assistant id", async () => {
    const t = await makeTestApp();
    t.ctx.db.prepare("UPDATE profiles SET vapi_assistant_id = 'asst_roof' WHERE id = 'summit-roofing'").run();
    const res = await t.http
      .post("/api/vapi/webhook")
      .set("x-vapi-secret", SECRET)
      .send({
        message: {
          type: "tool-calls",
          call: { id: "pstn-1", type: "inboundPhoneCall", assistantId: "asst_roof", customer: { number: "+13035550150" } },
          toolCallList: [{ id: "tc", function: { name: "mark_do_not_call", arguments: {} } }],
        },
      });
    expect(JSON.parse(res.body.results[0].result).ok).toBe(true); // used the caller ID
    const call = t.ctx.db.prepare("SELECT * FROM calls WHERE vapi_call_id = 'pstn-1'").get() as any;
    expect(call).toMatchObject({ profile_id: "summit-roofing", direction: "inbound", transport: "phone" });
  });

  it("finalises a call once: outcome from tool events, transcript, summary and private recording", async () => {
    const t = await makeTestApp();
    const prep = await prepareWebCall(t);
    const call = vapiCall(prep.sessionId);
    const hook = (body: object) => t.http.post("/api/vapi/webhook").set("x-vapi-secret", SECRET).send(body);

    const avail = await hook({
      message: { type: "tool-calls", call, toolCallList: [{ id: "a", function: { name: "check_availability", arguments: { service_id: "cleaning" } } }] },
    });
    const slot = JSON.parse(avail.body.results[0].result).options[0].slot_start;
    await hook({
      message: {
        type: "tool-calls",
        call,
        toolCallList: [
          { id: "b", function: { name: "book_appointment", arguments: { slot_start: slot, name: "Jordan Avery", phone: "312-555-0144", service_id: "cleaning" } } },
        ],
      },
    });

    const report = {
      message: {
        type: "end-of-call-report",
        call,
        endedReason: "customer-ended-call",
        artifact: {
          messages: [
            { role: "system", message: "prompt" },
            { role: "bot", message: "Thanks for calling Bright Smile Dental. I'm Ava, the clinic's AI assistant.", secondsFromStart: 0.5 },
            { role: "user", message: "I'd like a cleaning this week.", secondsFromStart: 4 },
          ],
          recordingUrl: "https://storage.vapi.test/rec.mp3",
        },
      },
    };
    await hook(report);
    await new Promise((r) => setTimeout(r, 50)); // end-of-call is processed after the 200
    await hook(report); // a retry must not double-process

    const row = getCallBySession(t.ctx.db, prep.sessionId)!;
    expect(row).toMatchObject({ status: "ended", outcome: "Booked", summary: "Test summary.", recording_path: `call-${row.id}.mp3` });
    expect(JSON.parse(row.transcript_json!)).toEqual([
      { role: "agent", text: expect.stringContaining("AI assistant"), secondsFromStart: 0.5 },
      { role: "caller", text: "I'd like a cleaning this week.", secondsFromStart: 4 },
    ]);
    expect(t.summarizer.calls).toHaveLength(1);
    expect(t.summarizer.calls[0].toolEvents).toEqual(["booked"]);

    // recording only through the authenticated API
    const cookie = await login(t.http);
    expect((await t.http.get(`/api/calls/${row.id}/recording`)).status).toBe(401);
    const rec = await t.http.get(`/api/calls/${row.id}/recording`).set("Cookie", cookie);
    expect(rec.status).toBe(200);
    expect(rec.headers["cache-control"]).toBe("private, no-store");
  });

  it("ignores messages it cannot parse without failing the call", async () => {
    const t = await makeTestApp();
    const res = await t.http.post("/api/vapi/webhook").set("x-vapi-secret", SECRET).send({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

describe("dashboard API auth", () => {
  it("blocks every admin route without a session and rejects a wrong password", async () => {
    const t = await makeTestApp();
    for (const path of ["/api/profiles", "/api/calls?profileId=x", "/api/leads?profileId=x", "/api/suppression"]) {
      expect((await t.http.get(path)).status).toBe(401);
    }
    expect((await t.http.post("/api/auth/login").send({ password: "guess" })).status).toBe(401);
    const cookie = await login(t.http);
    const profiles = await t.http.get("/api/profiles").set("Cookie", cookie);
    expect(profiles.body.map((p: any) => p.id)).toEqual(["bright-smile-dental", "summit-roofing"]);
  });

  it("never leaks the webhook secret in the assistant preview", async () => {
    const t = await makeTestApp();
    const cookie = await login(t.http);
    const res = await t.http.get("/api/profiles/summit-roofing/assistant").set("Cookie", cookie);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).toContain("[redacted]");
  });

  it("validates FAQ and hours edits from the admin", async () => {
    const t = await makeTestApp();
    const cookie = await login(t.http);
    const ok = await t.http
      .patch("/api/profiles/bright-smile-dental")
      .set("Cookie", cookie)
      .send({ faqs: [{ q: "Do you do Invisalign?", a: "Yes, consultations are free." }] });
    expect(ok.status).toBe(200);
    const bad = await t.http.patch("/api/profiles/bright-smile-dental").set("Cookie", cookie).send({ timezone: "Nowhere/Land" });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.join(" ")).toMatch(/timezone/);
  });
});
