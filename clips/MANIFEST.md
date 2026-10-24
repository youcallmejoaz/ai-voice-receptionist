# Clip manifest

1920x1080, H.264 (yuv420p, 30 fps), AAC where audio exists, no music, no watermark. Recorded
with `clips/record.mjs` (Playwright: visible cursor, highlight ring on every click, human-pace
typing, zoomed close-ups). Cards also have a PNG still. All data is the fictional sample data.

Status key: **done** = recorded and committed. **needs live call** = needs the deployed app
with Vapi keys (see "Recording the call clips" below).

| Clip | File | Duration | Audio | What it shows | Script section | Status |
|---|---|---|---|---|---|---|
| C01 | `C01_before.mp4` + `.png` | 8.0 s | no | Before card: missed calls, voicemails, lost bookings (labelled as an illustrative week) | Problem | done |
| C02 | `C02_flow.mp4` + `.png` | 10.1 s | no | Flow: call comes in > AI answers > qualifies > books > CRM > summary to you | How it works | done |
| C03 | `C03_profile_switch.mp4` | 7.5 s | no | Dashboard switching between the dental and roofing profiles | How it works | done* |
| C04 | `C04_inbound_dental.mp4` | ~15 s | yes | Inbound web call to the dental profile, live transcript appearing | Demo | needs live call |
| C05 | `C05_calendar_booking.mp4` | ~6 s | no | The booking from C04 appearing in the calendar view (zoomed) | Demo | needs live call |
| C06 | `C06_call_log_entry.mp4` | ~8 s | no | Call log entry: outcome Booked, AI summary, lead fields (zoomed) | Demo | needs live call |
| C07 | `C07_interruption.mp4` | ~10 s | yes | Caller interrupts mid-sentence, agent stops and answers the new question | Demo | needs live call |
| C08 | `C08_transfer.mp4` | ~8 s | yes | Caller asks for a person, transfer triggered | What could go wrong | needs live call |
| C09 | `C09_outbound_consent.mp4` | 9.7 s | no | Outbound list: consent column, do-not-call and no-consent leads skipped, consent log lines (zoomed) | Safeguards | done* |
| C10 | `C10_outbound_call.mp4` | ~12 s | yes | Outbound qualification call to consenting test lead Dana Whitfield | Demo | needs live call |
| C11 | `C11_calendar_fallback.mp4` | ~8 s | yes | Calendar outage switched on, agent takes a callback request instead | What could go wrong | needs live call |
| C12 | `C12_edit_faqs_hours.mp4` | 12.5 s | no | Adding an FAQ and changing Saturday hours, saved (zoomed). Longer than the 8 s target because typing is at human pace | Business value | done* |
| C13 | `C13_prompt_plan.mp4` | 11.0 s | no | Dark terminal replay: planning prompt typed, phased plan appears | How I built it | done |
| C14 | `C14_prompt_second_profile.mp4` | 8.5 s | no | Terminal replay: "add a second business profile" prompt and the result (tests pass, no code changed) | How I built it | done |
| C15 | `C15_safeguards.mp4` + `.png` | 8.1 s | no | Safeguards card: consent checks, do not call, AI disclosure, private recordings | What could go wrong | done |
| C16 | `C16_cost_estimate.mp4` + `.png` | 8.1 s | no | Cost per 100 calls, labelled as an estimate (figures from docs/SETUP.md) | Business value | done |

\* Recorded on a local build without Vapi keys, so the dashboard shows "Not synced to Vapi" and a
missing-key notice. Re-record these with `ui` against the deployed app for the final video. C09
was recorded with `DEMO_CLOCK` set to a Monday morning, because the outbound gate correctly
refuses calls outside 8am to 9pm and the recording ran at night US time.

Call clips also produce `Cxx_audio.mp3` (the matching slice of the call recording), because
Playwright can't capture system audio. The same audio is muxed into the MP4.

## Recording the call clips

On a machine with a desktop browser stack (call clips need WebRTC, so not in a locked-down container):

```bash
npm ci && npx playwright install chromium
./clips/make-caller-audio.sh      # scripted caller lines (clips/caller-lines.txt) -> clips/audio/*.wav
BASE_URL=https://<your-app>.onrender.com ADMIN_PASSWORD=... node clips/record.mjs calls ui
./clips/build-proposal.sh          # proposal cut from C01 C04 C05 C06 C16
```

The recorder replaces the browser microphone with the scripted caller lines and plays each one
when the agent has finished speaking, or mid-sentence for the interruption clip. Replace the
generated WAVs with real voice recordings for a more natural demo. Raw recordings and timing
marks stay in `clips/raw/` (git-ignored) if a clip needs re-trimming.

## Proposal cut

`build-proposal.sh` concatenates C01, C04, C05, C06 and C16, which comes to about 45 s, short
of the 60–90 s target. Pass extra clip ids to lengthen it, e.g.
`./build-proposal.sh C01 C02 C04 C05 C06 C15 C16` (~63 s).
