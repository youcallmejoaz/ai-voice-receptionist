"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useProfiles } from "@/components/ProfileProvider";
import { api } from "@/lib/api";

interface Slot {
  startUtc: string;
  endUtc: string;
  booked: number;
}
interface Appt {
  id: number;
  service: string;
  startUtc: string;
  endUtc: string;
  callId: number | null;
  leadName: string | null;
}
interface CalendarData {
  timezone: string;
  provider: string;
  now: string;
  slots: Slot[];
  appointments: Appt[];
}

export default function CalendarPage() {
  const { current } = useProfiles();
  const [data, setData] = useState<CalendarData | null>(null);

  useEffect(() => {
    if (!current) return;
    const load = () => api<CalendarData>(`/api/calendar?profileId=${current.id}&days=7`).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [current?.id]);

  if (!data) return <p className="muted">Loading…</p>;
  const tz = data.timezone;
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const days = [...new Set(data.slots.map((s) => dayKey(s.startUtc)))];
  const apptAt = (iso: string) => data.appointments.find((a) => a.startUtc <= iso && iso < a.endUtc);
  const newest = Math.max(0, ...data.appointments.map((a) => a.id));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="muted">
            Next 7 days in {tz} · {data.provider === "mock" ? "demo calendar" : "Google Calendar"} · grey = already taken, green = booked by the AI
          </p>
        </div>
      </div>
      <div className="calendar">
        {days.map((day) => {
          const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
          return (
            <div className="cal-day" key={day}>
              <div className="cal-head">{label}</div>
              {data.slots
                .filter((s) => dayKey(s.startUtc) === day)
                .map((s) => {
                  const a = apptAt(s.startUtc);
                  if (a && a.startUtc !== s.startUtc) return null; // covered by a longer appointment
                  return a ? (
                    <Link
                      key={s.startUtc}
                      href={a.callId ? `/calls/${a.callId}` : "#"}
                      className={`cal-slot ai ${a.id === newest ? "newest" : ""}`}
                      data-testid="cal-appointment"
                    >
                      <strong>{time(a.startUtc)}</strong> {a.leadName}
                      <span>{a.service}</span>
                    </Link>
                  ) : (
                    <div key={s.startUtc} className={`cal-slot ${s.startUtc < data.now ? "past" : s.booked ? "taken" : "open"}`}>
                      {time(s.startUtc)}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </>
  );
}
