import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "./config.js";

const COOKIE = "avr_session";
const TTL_MS = 12 * 3600_000;

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function sign(secret: string, value: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueSession(cfg: AppConfig, res: Response) {
  const expires = String(Date.now() + TTL_MS);
  res.cookie(COOKIE, `${expires}.${sign(cfg.sessionSecret, expires)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: cfg.nodeEnv === "production",
    maxAge: TTL_MS,
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export function hasValidSession(cfg: AppConfig, req: Request): boolean {
  const raw = req.cookies?.[COOKIE];
  if (typeof raw !== "string" || !cfg.sessionSecret) return false;
  const [expires, sig] = raw.split(".");
  if (!expires || !sig || !safeEqual(sig, sign(cfg.sessionSecret, expires))) return false;
  return Number(expires) > Date.now();
}

/** Dashboard API guard. Recordings, transcripts and lead data are never public. */
export function requireAdmin(cfg: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (hasValidSession(cfg, req)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

/** Vapi webhook guard: the shared secret configured on the assistant comes back on every request. */
export function requireVapiSecret(cfg: AppConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const got = req.header("x-vapi-secret") ?? "";
    if (cfg.vapiWebhookSecret && safeEqual(got, cfg.vapiWebhookSecret)) return next();
    res.status(401).json({ error: "invalid webhook secret" });
  };
}
