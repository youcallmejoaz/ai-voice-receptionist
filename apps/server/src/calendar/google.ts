import type { BusinessProfile } from "../profiles/schema.js";
import { CalendarUnavailableError, SlotTakenError, type BookingDetails, type CalendarAdapter, type Slot } from "./adapter.js";
import { generateBusinessSlots } from "./slots.js";

type FetchFn = typeof fetch;

export interface GoogleCalendarOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchFn?: FetchFn;
}

/**
 * Google Calendar adapter (REST, OAuth refresh token). Free slots = business-hours slots minus
 * free/busy. Any network or API failure surfaces as CalendarUnavailableError so the agent falls
 * back to taking a callback request.
 */
export class GoogleCalendar implements CalendarAdapter {
  readonly name = "google";
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: GoogleCalendarOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.call("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
        refresh_token: this.opts.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new CalendarUnavailableError(`Google Calendar unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new CalendarUnavailableError(`Google Calendar responded ${res.status}`);
    return res;
  }

  private async busy(profile: BusinessProfile, fromUtc: string, toUtc: string): Promise<Slot[]> {
    const token = await this.accessToken();
    const res = await this.call("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: fromUtc, timeMax: toUtc, items: [{ id: profile.booking.googleCalendarId }] }),
    });
    const body = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
    const cal = body.calendars[profile.booking.googleCalendarId];
    return (cal?.busy ?? []).map((b) => ({ startUtc: new Date(b.start).toISOString(), endUtc: new Date(b.end).toISOString() }));
  }

  async listOpenSlots(profile: BusinessProfile, fromUtc: string, toUtc: string): Promise<Slot[]> {
    const days = Math.ceil((Date.parse(toUtc) - Date.parse(fromUtc)) / 86_400_000) + 1;
    const candidates = generateBusinessSlots(profile, new Date(fromUtc), days).filter(
      (s) => s.startUtc >= fromUtc && s.startUtc < toUtc,
    );
    const busy = await this.busy(profile, fromUtc, toUtc);
    return candidates.filter((s) => !busy.some((b) => s.startUtc < b.endUtc && b.startUtc < s.endUtc));
  }

  async book(profile: BusinessProfile, slot: Slot, details: BookingDetails): Promise<{ ref: string }> {
    const clash = await this.busy(profile, slot.startUtc, slot.endUtc);
    if (clash.length) throw new SlotTakenError();
    const token = await this.accessToken();
    const res = await this.call(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(profile.booking.googleCalendarId)}/events`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          summary: `${details.service}: ${details.name}`,
          description: [`Phone: ${details.phone}`, details.email && `Email: ${details.email}`, details.notes, "Booked by AI receptionist"]
            .filter(Boolean)
            .join("\n"),
          start: { dateTime: slot.startUtc },
          end: { dateTime: slot.endUtc },
        }),
      },
    );
    const body = (await res.json()) as { id: string };
    return { ref: body.id };
  }
}
