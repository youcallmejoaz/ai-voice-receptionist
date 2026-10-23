import type { CalendarAdapter } from "../calendar/adapter.js";
import type { CallRow } from "../calls.js";
import type { CrmAdapter } from "../crm/adapter.js";
import type { DB } from "../db/index.js";
import type { BusinessProfile } from "../profiles/schema.js";

export interface ToolContext {
  db: DB;
  calendar: CalendarAdapter;
  crm: CrmAdapter;
  profile: BusinessProfile;
  call: CallRow | null;
  /** Caller ID on phone calls; null on web calls. */
  customerPhone: string | null;
  telephonyEnabled: boolean;
  now: () => Date;
}

/**
 * Every tool returns plain JSON. `say` is guidance the agent should turn into its next sentence;
 * `error` codes let it recover (re-ask, offer alternatives, fall back) instead of stalling.
 */
export interface ToolResult {
  ok: boolean;
  error?: string;
  fallback?: "take_callback" | "offer_transfer";
  say?: string;
  [key: string]: unknown;
}
