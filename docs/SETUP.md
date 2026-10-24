# Setup guide

Time needed: about 30 minutes for a first deploy.

## 1. Accounts you need

| Service | What for | Required |
|---|---|---|
| [Vapi](https://vapi.ai) | Voice platform: speech-to-text, the LLM turn loop, text-to-speech, browser and phone calls | Yes |
| [Anthropic](https://console.anthropic.com) | Post-call summaries with Claude (falls back to Vapi's own summary without a key) | Recommended |
| [Render](https://render.com) | Hosting: one web service plus a 1 GB persistent disk | Yes, for live calls (Vapi must reach a public HTTPS URL) |
| Twilio or a Vapi number | Real phone calls. **Not needed for the demo**: browser calls work without a number | Optional |
| Google Cloud OAuth client | Real Google Calendar instead of the demo calendar | Optional |

## 2. Run locally (no calls, everything else works)

```bash
npm ci
cp .env.example .env        # set ADMIN_PASSWORD and SESSION_SECRET at least
npm run seed                # loads both business profiles and the do-not-call list
npm test                    # 60+ tests: tools, consent checks, profile loading, webhook
npm run build && npm start  # http://localhost:3000, sign in with ADMIN_PASSWORD
```

Locally you can switch profiles, edit FAQs and hours, upload the lead list and run the consent
checks. Calls need step 3, because Vapi has to reach the webhook over public HTTPS.

## 3. Deploy to Render

1. Push this repo to GitHub, then in Render choose **New → Blueprint** and pick the repo. `render.yaml`
   creates one Starter web service with a 1 GB disk at `/var/data`. Render generates
   `SESSION_SECRET` and `VAPI_WEBHOOK_SECRET` for you.
2. In the service's **Environment** tab set:
   - `ADMIN_PASSWORD`: the dashboard password
   - `VAPI_PRIVATE_KEY` and `VAPI_PUBLIC_KEY`: Vapi dashboard → Organization → API Keys
   - `ANTHROPIC_API_KEY`: for Claude summaries
3. Deploy. On start the server syncs one Vapi assistant per business profile (the log shows
   `synced bright-smile-dental -> Vapi assistant ...`). `PUBLIC_BASE_URL` defaults to Render's own
   URL; set it only if you use a custom domain.
4. Open the app, sign in, go to **Business profile** and check both profiles say synced. Then open
   **Live call** and press **Start web call**.

### Optional: real phone calls

Buy or import a number in Vapi, then set `VAPI_PHONE_NUMBER_ID`. That enables:
- outbound phone calls from the Outbound page (still only to leads that pass consent and do-not-call checks)
- live warm transfer to the profile's `transfer.number` (on browser calls transfers are logged and
  flagged on the dashboard but cannot bridge to a phone line)

Point the Vapi number's assistant at the synced assistant for inbound calls.

### Optional: Google Calendar

Create an OAuth client (Desktop app), get a refresh token with the
`https://www.googleapis.com/auth/calendar` scope, then set `CALENDAR_PROVIDER=google`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `booking.googleCalendarId`
in each profile. Free time is your business hours minus busy events.

### Optional: CRM

Set `CRM_WEBHOOK_URL` to a Zapier, Make, n8n or HubSpot workflow webhook. Every lead event
(`lead_qualified`, `appointment_booked`, `callback_requested`, ...) is POSTed as JSON, with one
retry. Leads always stay visible in the dashboard's CRM view.

## 4. Add a new business

Copy `profiles/summit-roofing.json` to `profiles/<new-id>.json` and edit the facts: name,
timezone, hours, FAQs, services, qualification questions and rules, transfer target, outbound
opening line. Restart (or redeploy). The file is validated on load: a bad timezone, missing
services or opening after closing stops the server with the exact field path. The core logic,
tools and safeguards don't change. After the first load, edits made in the dashboard live in the
database; `npm run seed` resets profiles to the files.

## 5. Recurring costs (estimates)

All figures are **estimates** from public pricing in October 2026. Check each provider's
pricing page before quoting a client. Assumes a 3-minute average call.

| Item | Rate (estimate) | Per 100 calls (300 min) |
|---|---|---|
| Vapi platform fee | $0.05 / min | $15.00 |
| Speech-to-text (Deepgram Nova-3 via Vapi) | ~$0.01 / min | ~$3.00 |
| LLM turns (Claude Haiku 5.5 via Vapi, ~30k input tokens per call) | ~$0.001–0.003 / min | ~$0.50–1.00 |
| Text-to-speech (Vapi voices; ElevenLabs costs more) | ~$0.02–0.07 / min | ~$6–21 |
| Telephony, only for phone calls (Twilio: inbound $0.0085, outbound $0.014 / min) | ~$0.01 / min | ~$2.50–4.20 |
| Post-call summaries (Claude Haiku 5.5) | ~$0.0003 / call | ~$0.03 |
| **Usage total** | **~$0.09–0.15 / min** | **~$27–45** |

Fixed monthly:

| Item | Estimate |
|---|---|
| Render Starter instance | $7 |
| Render persistent disk, 1 GB | $0.25 |
| Render workspace (Hobby plan) | $0 |
| Phone number (Twilio local), only for phone calls | $1.15 per number |
| Vapi concurrency beyond the included lines | $10 per extra line |

So a small business taking 100 three-minute calls a month costs roughly **$35–55 a month**
including hosting. Browser-only demos have no telephony cost.

Sources: Vapi platform fee from third-party 2026 breakdowns (Vapi's pricing page is the
authority); Twilio rates from twilio.com/voice/pricing/us; Render from render.com/pricing and the
August 2026 workspace plan change; Claude prices from Anthropic's model pricing.

## 6. Safeguards and where they live

| Safeguard | Implementation |
|---|---|
| AI disclosure | Every first sentence must contain "AI"; `withDisclosure()` adds one if a greeting forgets (`apps/server/src/assistant/prompt.ts`), tested for both profiles |
| Consent before outbound | Lead CSV must have a `consent` column, anything but an explicit yes is no (`outbound/csv.ts`) |
| Do-not-call | Numbers normalised to E.164 before every comparison; gate runs when the list is run **and** again right before dialling (`outbound/gate.ts`, `outbound/dialer.ts`) |
| Opt-out during a call | `mark_do_not_call` tool adds the number immediately; re-imports with consent=yes stay blocked |
| Quiet hours | No outbound calls outside 8am–9pm business time; leads wait in the queue |
| Private recordings | Copied from Vapi to the server's disk, served only to signed-in admins with `cache-control: private, no-store` |
| No hardcoded secrets | Everything comes from env vars; the webhook secret is checked on every Vapi request with a timing-safe compare, and redacted in the dashboard's assistant preview |
| Dashboard access | Password login, signed httpOnly SameSite=Strict cookie, login rate limit |

Before using this for real customers, also delete the recordings Vapi keeps on its side (or use
Vapi's custom storage option), set data retention to match your privacy policy, and check the
call recording consent law where your callers are (some US states require all parties to agree).
