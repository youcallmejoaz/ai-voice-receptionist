# AI Voice Receptionist

A reusable AI phone receptionist for small businesses, built on [Vapi](https://vapi.ai). It answers
calls, answers FAQs, qualifies the caller, books appointments, hands off to a person when needed,
writes a summary to the CRM, and calls back leads who asked for it. It always checks consent and
the do-not-call list first.

Each business is one JSON profile. Two are included: **Bright Smile Dental** (clinic) and
**Summit Roofing Co.** (home services). Adding a third means writing a profile; the code
doesn't change.

## What it does

- **Answers inbound calls**, in the browser (no phone number needed) or on a real number. The
  first sentence always says the caller is talking to an AI assistant.
- **Six tools the agent calls**: `check_availability`, `book_appointment`, `request_callback`,
  `create_lead`, `transfer_to_human`, `mark_do_not_call`. Each returns recoverable errors (invalid
  date, incomplete phone number, slot just taken), so the agent can re-ask instead of stalling.
- **Qualification rules as data**, for example the roofing company's service-area ZIPs, owner-only
  and residential-only rules. Not-a-fit callers get the specific reason.
- **Fallbacks**: one clarifying question then an offer to transfer; if the calendar is down, the
  agent takes a callback request instead.
- **Outbound follow-up**: upload a lead CSV with a consent column. Leads without consent, on the
  do-not-call list, or outside 8am–9pm are skipped (or wait), and each skip is logged.
- **Admin dashboard**: switch business, edit FAQs and hours, live call with transcript, call log
  with outcome (Booked, Qualified, Not a fit, Transferred, Opt out, Callback), AI summary, lead
  fields and the private recording, calendar and CRM views.

## Architecture

```
Browser / phone ──► Vapi (STT · Claude Haiku 5.5 · TTS) ──tool calls──► Express API ──► SQLite (Render disk)
                                                     ◄── results ──┘     │ calendar adapter: mock | Google
Dashboard (Next.js, same origin) ◄──────────────── admin API ────────────┤ CRM adapter: local | webhook
                                                                          └ Claude summaries · private recordings
```

- `apps/server`: Express API, Vapi webhook, tools, adapters, outbound dialer (TypeScript)
- `apps/dashboard`: Next.js admin UI, served by the same process
- `profiles/`: one JSON file per business, validated with zod on load
- `seed/`: 15 fictional test leads (consent yes/no) and a 2-number do-not-call list
- `clips/`: demo video clips and the Playwright recorder

**Why Vapi:** the assistant definition is generated from the profile and synced through Vapi's
API, so each business gets the same logic with its own facts. Vapi provides browser calls, server
tool calls, transfer and end-call tools, and an end-of-call report with transcript and recording.
Retell is a strong alternative, but agent configuration lives more on the platform side.

## Quick start

```bash
npm ci
cp .env.example .env   # set ADMIN_PASSWORD and SESSION_SECRET
npm run seed
npm test
npm run build && npm start   # http://localhost:3000
```

Live calls need a public HTTPS URL for Vapi's webhooks; deploy to Render with the included
`render.yaml`. See **[docs/SETUP.md](docs/SETUP.md)** for deployment, phone numbers, Google
Calendar, CRM webhook, and the **recurring cost estimates**. **[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)**
is the live test script.

## Tests

`npm test` runs 60+ vitest tests covering:
- every tool endpoint, including bad arguments, double booking, invalid phone and date, calendar outage
- consent checks: CSV without a consent column, consent values, do-not-call matching across number
  formats, quiet hours, the gate re-run before dialling, opt-out during a call
- profile loading: both sample profiles, invalid timezone, hours or JSON, duplicate ids, edit validation
- the Vapi webhook: tool-call response format, call matching, end-of-call finalisation (once),
  private recording access
- a compile-time contract: the generated assistant type-checks against Vapi's own `CreateAssistantDTO`

## Safeguards

AI disclosure on every call, consent and do-not-call checks before any outbound call, quiet hours,
opt-out honoured immediately, recordings stored privately behind the admin login, and no secrets
in code. Details in [docs/SETUP.md](docs/SETUP.md#6-safeguards-and-where-they-live).

All names, numbers and emails in this repo are fictional. Phone numbers use the reserved 555-01xx range.
