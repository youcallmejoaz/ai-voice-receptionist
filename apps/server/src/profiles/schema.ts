import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)");
const dayHours = z.union([z.null(), z.object({ open: hhmm, close: hhmm })]);

export const QualificationRule = z.object({
  field: z.string().min(1),
  op: z.enum(["equals", "notEquals", "in", "notIn", "startsWithAny"]),
  value: z.union([z.string(), z.array(z.string())]),
  failReason: z.string().min(1),
});

export const BusinessProfile = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  name: z.string().min(1),
  industry: z.string().min(1),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "unknown IANA timezone"),
  address: z.string().default(""),
  website: z.string().default(""),
  agent: z.object({
    name: z.string().min(1),
    voice: z.object({ provider: z.string().min(1), voiceId: z.string().min(1) }),
    greeting: z.string().min(1),
    personality: z.string().default("warm, concise and professional"),
  }),
  hours: z.object({
    mon: dayHours,
    tue: dayHours,
    wed: dayHours,
    thu: dayHours,
    fri: dayHours,
    sat: dayHours,
    sun: dayHours,
  }),
  faqs: z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).default([]),
  services: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), durationMin: z.number().int().positive() }))
    .min(1),
  qualification: z.object({
    questions: z.array(z.object({ field: z.string().min(1), ask: z.string().min(1), required: z.boolean().default(true) })),
    rules: z.array(QualificationRule).default([]),
  }),
  booking: z.object({
    slotMinutes: z.number().int().positive().default(30),
    leadTimeHours: z.number().nonnegative().default(2),
    maxDaysAhead: z.number().int().positive().default(14),
    bookingLink: z.string().default(""),
    googleCalendarId: z.string().default("primary"),
  }),
  transfer: z.object({
    label: z.string().min(1),
    number: z.string().min(1),
    when: z.array(z.string()).default([]),
  }),
  outbound: z.object({
    purpose: z.string().min(1),
    firstMessage: z.string().min(1),
  }),
});

export type BusinessProfile = z.infer<typeof BusinessProfile>;
export type QualificationRule = z.infer<typeof QualificationRule>;
