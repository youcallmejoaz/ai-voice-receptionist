"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export interface Line {
  role: "agent" | "caller";
  text: string;
  final: boolean;
}

export interface PreparedCall {
  sessionId: string;
  callId: number;
  assistantId: string;
  assistantOverrides: Record<string, unknown>;
}

type Status = "idle" | "connecting" | "live" | "ended" | "error";

/**
 * Browser call through the Vapi web SDK. The server prepares the call (our record + overrides),
 * the SDK starts it with the synced assistant id, and we attach Vapi's call id to our record.
 */
export function useWebCall(publicKey: string | null) {
  const vapiRef = useRef<any>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<number | null>(null);

  useEffect(() => () => void vapiRef.current?.stop?.(), []);

  const ensureClient = useCallback(async () => {
    if (vapiRef.current) return vapiRef.current;
    const { default: Vapi } = await import("@vapi-ai/web");
    const vapi = new Vapi(publicKey!);
    vapi.on("call-start", () => setStatus("live"));
    vapi.on("call-end", () => {
      setStatus("ended");
      setAgentSpeaking(false);
      setVolume(0);
    });
    vapi.on("speech-start", () => setAgentSpeaking(true));
    vapi.on("speech-end", () => setAgentSpeaking(false));
    vapi.on("volume-level", (v: number) => setVolume(v));
    vapi.on("error", (e: unknown) => {
      setError(typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "Call error");
      setStatus("error");
    });
    vapi.on("message", (m: any) => {
      if (m?.type !== "transcript" || !m.transcript) return;
      const role: Line["role"] = m.role === "assistant" ? "agent" : "caller";
      const final = m.transcriptType === "final";
      setLines((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === role && !last.final) next[next.length - 1] = { role, text: m.transcript, final };
        else next.push({ role, text: m.transcript, final });
        return next;
      });
    });
    vapiRef.current = vapi;
    return vapi;
  }, [publicKey]);

  const start = useCallback(
    async (prepare: () => Promise<PreparedCall>) => {
      if (!publicKey) {
        setError("VAPI_PUBLIC_KEY is not configured on the server");
        setStatus("error");
        return;
      }
      setError(null);
      setLines([]);
      setStatus("connecting");
      try {
        const prepared = await prepare();
        setCallId(prepared.callId);
        const vapi = await ensureClient();
        const call = await vapi.start(prepared.assistantId, prepared.assistantOverrides);
        if (call?.id) await api(`/api/calls/${prepared.sessionId}/attach`, { method: "POST", json: { vapiCallId: call.id } });
      } catch (e) {
        setError((e as Error).message);
        setStatus("error");
      }
    },
    [publicKey, ensureClient],
  );

  const stop = useCallback(() => vapiRef.current?.stop(), []);
  const toggleMute = useCallback(() => {
    const next = !muted;
    vapiRef.current?.setMuted(next);
    setMuted(next);
  }, [muted]);

  return { status, lines, agentSpeaking, volume, muted, error, callId, start, stop, toggleMute };
}
