"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body?.error ?? `Request failed (${status})`);
  }
}

/** Fetch JSON from the same-origin API. A 401 sends the user to the login page. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 401 && !path.startsWith("/api/auth")) {
    window.location.href = "/login";
    throw new ApiError(401, { error: "unauthorized" });
  }
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function formatWhen(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export const OUTCOME_LABEL: Record<string, string> = {
  Booked: "Booked",
  Qualified: "Qualified",
  NotFit: "Not a fit",
  Transferred: "Transferred",
  OptOut: "Opt out",
  Callback: "Callback",
  Incomplete: "Incomplete",
};

export const OUTCOME_TONE: Record<string, "green" | "amber" | "red" | "grey" | "blue"> = {
  Booked: "green",
  Qualified: "green",
  NotFit: "grey",
  Transferred: "blue",
  OptOut: "red",
  Callback: "amber",
  Incomplete: "grey",
};
