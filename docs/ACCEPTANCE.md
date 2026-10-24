# Live acceptance script

Run on the deployed app (browser calls need HTTPS). Reset a profile between runs with
`POST /api/demo/reset {"profileId": "..."}` while signed in, or reseed. Each scenario lists what you
say and what must appear.

| # | Scenario | Profile | You say | Pass when |
|---|---|---|---|---|
| A1 | Inbound enquiry → booking | Bright Smile Dental | "Hi, I'd like to book a cleaning. I'm a new patient, adult, I have Delta. Thursday afternoon works." Give a name and a 555 number. | Agent says it's an AI first; Calendar shows a green booking; CRM lead status **booked**; call log outcome **Booked** with summary |
| A2 | Inbound enquiry → booking | Summit Roofing | "I've got hail damage. ZIP 80401, I own the house, it's residential, nothing leaking yet." | Same as A1 on the roofing profile |
| A3 | Outbound qualification | Summit Roofing | Upload `seed/do-not-call.csv` then `seed/leads.csv`, press **Run consent checks**, then **Call** on Dana Whitfield. Answer the questions. | Hannah and Liam show "Skipped: do-not-call", Tom/Victor/Sofia/Noah "No recorded consent"; consent log shows each skip; Dana's call ends Qualified or Booked |
| A4 | Interruption | either | Start talking while the agent is mid-sentence: "Sorry, actually, do you take Cigna?" | Agent stops within a word or two and answers the new question |
| A5 | Invalid input recovery | Bright Smile Dental | Give a phone number with missing digits ("555-01"), or ask for "the day after the thing". | Agent asks you to repeat it (tool returned `invalid_phone` / `invalid_date`), then continues |
| A6 | Calendar failure fallback | either | Tick **Simulate calendar outage**, then ask to book. | Agent apologises, takes a callback request; outcome **Callback**; actions show "Calendar unavailable" |
| A7 | Human transfer | either | "Can I just talk to a real person?" | Actions show "Transfer to the front desk"; outcome **Transferred** (simulated on browser calls, live with a phone number) |
| A8 | Misunderstood request | either | Mumble or say something off-topic twice. | One clarifying question, then an offer to transfer |
| A9 | Opt-out | Summit Roofing (outbound) | "Please stop calling me." | Number appears in the do-not-call list; outcome **Opt out**; re-running the list skips that lead |
