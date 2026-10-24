import path from "node:path";
import type { CreateAssistantDTO, ServerMessageToolCalls } from "@vapi-ai/web/dist/api.js";
import { describe, expect, it } from "vitest";
import { buildAssistant } from "../src/assistant/build.js";
import { loadProfilesFromDir } from "../src/profiles/loader.js";
import { TOOLS, toolParameters, type ToolName } from "../src/tools/registry.js";
import { REPO } from "./helpers.js";

/**
 * Compile-time contract: the generated assistant must satisfy Vapi's own CreateAssistantDTO type
 * (from the @vapi-ai/web SDK). `npm run typecheck` fails if a field drifts from the platform API.
 */
describe("Vapi API contract", () => {
  it.each([false, true])("assistant matches CreateAssistantDTO (telephony %s)", (telephonyEnabled) => {
    for (const p of loadProfilesFromDir(path.join(REPO, "profiles"))) {
      const dto: CreateAssistantDTO = buildAssistant(p, {
        webhookUrl: "https://x.test/api/vapi/webhook",
        webhookSecret: "s",
        llmProvider: "anthropic",
        llmModel: "claude-haiku-5-5",
        telephonyEnabled,
      });
      expect(dto.model?.provider).toBe("anthropic");
    }
  });

  it("tool parameters only use JSON Schema keywords Vapi accepts", () => {
    const allowed = new Set(["type", "items", "properties", "description", "pattern", "format", "required", "enum", "title"]);
    const walk = (node: any): void => {
      for (const [k, v] of Object.entries(node)) {
        expect(allowed.has(k), `unexpected keyword ${k}`).toBe(true);
        if (k === "properties") Object.values(v as object).forEach(walk);
        if (k === "items") walk(v);
      }
    };
    const roof = loadProfilesFromDir(path.join(REPO, "profiles")).find((p) => p.id === "summit-roofing")!;
    for (const name of Object.keys(TOOLS) as ToolName[]) walk(toolParameters(name, roof));
    expect(Object.keys((toolParameters("create_lead", roof) as any).properties.answers.properties)).toEqual(["zip", "owner", "property_type", "urgency"]);
  });

  it("our tool-call fixture shape matches Vapi's ServerMessageToolCalls", () => {
    const msg: Pick<ServerMessageToolCalls, "type" | "toolCallList"> = {
      type: "tool-calls",
      toolCallList: [{ id: "tc", type: "function", function: { name: "check_availability", arguments: "{}" } }],
    };
    expect(msg.toolCallList).toHaveLength(1);
  });
});
