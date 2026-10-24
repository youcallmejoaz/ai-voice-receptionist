#!/usr/bin/env node
/**
 * Records the demo clips at 1920x1080 with Playwright and converts them to MP4 with ffmpeg.
 *
 *   node clips/record.mjs cards ui        # no voice calls needed
 *   node clips/record.mjs calls           # needs a deployed app with Vapi configured (HTTPS)
 *   node clips/record.mjs C03 C09         # specific clips
 *
 * Env: BASE_URL (default http://localhost:3000), ADMIN_PASSWORD (required for ui/calls).
 * Call clips get their audio from the call recording (Playwright cannot capture system audio):
 * it is saved as clips/Cxx_audio.mp3 and muxed into the MP4 as AAC.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, "..");
const RAW = path.join(DIR, "raw");
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const W = 1920;
const H = 1080;
fs.mkdirSync(RAW, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ cursor + click ring overlay
const OVERLAY = `(() => {
  if (window.__overlay) return; window.__overlay = true;
  const start = JSON.parse(sessionStorage.getItem("__cur") || '{"x":960,"y":620}');
  const mount = () => {
    const c = document.createElement("div");
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#101828" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: 0, top: 0, zIndex: 2147483647, pointerEvents: "none", transform: "translate(" + start.x + "px," + start.y + "px)" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => {
      c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
      sessionStorage.setItem("__cur", JSON.stringify({ x: e.clientX, y: e.clientY }));
    }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 28 + "px", top: e.clientY - 28 + "px", width: "56px", height: "56px", borderRadius: "50%",
        border: "4px solid #12805c", background: "rgba(18,128,92,.15)", zIndex: 2147483646, pointerEvents: "none" });
      document.documentElement.appendChild(r);
      r.animate([{ transform: "scale(.3)", opacity: 1 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 650, easing: "ease-out" }).onfinish = () => r.remove();
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount); else mount();
})();`;

// Caller audio: the page's microphone is replaced by a stream we can play scripted lines into.
const CALLER_AUDIO = `(() => {
  const state = (window.__caller = { ctx: null, dest: null });
  const ensure = () => {
    state.ctx ||= new AudioContext({ sampleRate: 48000 });
    state.dest ||= state.ctx.createMediaStreamDestination();
    return state;
  };
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => (c && c.audio && !c.video ? ensure().dest.stream : real(c));
  window.__playLine = async (url) => {
    const { ctx, dest } = ensure();
    await ctx.resume();
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(dest); src.start();
    return buf.duration;
  };
})();`;

// ------------------------------------------------------------------ clip session helpers
async function session(browser, id, { login = false, callerAudio = false, cursor = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW, size: { width: W, height: H } },
    permissions: callerAudio ? ["microphone"] : [],
  });
  if (login) {
    const res = await context.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
    if (!res.ok()) throw new Error(`login failed (${res.status()}): set ADMIN_PASSWORD`);
  }
  if (cursor) await context.addInitScript(OVERLAY);
  if (callerAudio) {
    await context.addInitScript(CALLER_AUDIO);
    await context.route(`${BASE}/__caller/**`, (route) => route.fulfill({ path: path.join(DIR, "audio", path.basename(new URL(route.request().url()).pathname)) }));
  }
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = {};
  const s = {
    id,
    page,
    context,
    marks,
    mark: (name) => (marks[name] = (Date.now() - t0) / 1000),
    api: (method, url, data) => context.request.fetch(`${BASE}${url}`, { method, data }),
    async move(x, y) {
      const from = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__cur") || '{"x":960,"y":620}'));
      await page.mouse.move(from.x, from.y);
      const steps = Math.max(12, Math.round(Math.hypot(x - from.x, y - from.y) / 22));
      await page.mouse.move(x, y, { steps });
    },
    async click(locator, { after = 700 } = {}) {
      const el = typeof locator === "string" ? page.locator(locator).first() : locator;
      await el.scrollIntoViewIfNeeded();
      const b = await el.boundingBox();
      await s.move(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(250);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(after);
    },
    async type(locator, text, { clear = true, delay = 65 } = {}) {
      await s.click(locator, { after: 200 });
      if (clear) await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type(text, { delay });
      await sleep(400);
    },
    /** Smooth close-up on an element (zoomed recording), then back out. */
    async zoom(locator, scale = 1.8, hold = 2200) {
      const el = page.locator(locator).first();
      await el.evaluate((n) => n.scrollIntoView({ behavior: "smooth", block: "center" }));
      await sleep(600);
      const b = await el.boundingBox();
      const ox = b.x + b.width / 2;
      const oy = b.y + b.height / 2;
      await page.evaluate(([ox, oy, scale]) => {
        const el = document.documentElement;
        el.style.transition = "transform .9s cubic-bezier(.3,.7,.2,1)";
        el.style.transformOrigin = `${ox}px ${oy + scrollY}px`;
        el.style.transform = `scale(${scale})`;
      }, [ox, oy, scale]);
      await sleep(900 + hold);
    },
    async unzoom() {
      await page.evaluate(() => (document.documentElement.style.transform = "none"));
      await sleep(900);
    },
  };
  return s;
}

/** Close the session, then cut [from, to] (seconds) out of the raw video into clips/<file>.mp4. */
async function finish(s, file, from, to, audio) {
  const video = s.page.video();
  await s.context.close();
  const raw = path.join(RAW, `${s.id}.webm`);
  fs.renameSync(await video.path(), raw);
  fs.writeFileSync(path.join(RAW, `${s.id}.json`), JSON.stringify({ marks: s.marks, from, to }, null, 2));
  const out = path.join(DIR, `${file}.mp4`);
  const args = ["-y", "-loglevel", "error", "-ss", String(from), "-to", String(to), "-i", raw];
  if (audio) args.push("-ss", String(audio.from), "-t", String(to - from), "-i", audio.file);
  args.push("-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart");
  if (audio) args.push("-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "160k", "-shortest");
  else args.push("-an");
  args.push(out);
  execFileSync("ffmpeg", args);
  console.log(`✓ ${file}.mp4 (${(to - from).toFixed(1)}s${audio ? ", audio" : ""})`);
}

// ------------------------------------------------------------------ cards and terminal replays
async function recordPage(browser, id, file, url, seconds, { still = true } = {}) {
  const s = await session(browser, id, { cursor: false });
  await s.page.goto(url);
  await s.page.evaluate(() => document.fonts.ready);
  s.mark("start");
  await sleep(seconds * 1000);
  if (still) await s.page.screenshot({ path: path.join(DIR, `${file}.png`) });
  s.mark("end");
  await finish(s, file, s.marks.start, s.marks.end);
}

const cardUrl = (f) => pathToFileURL(path.join(DIR, "cards", f)).href;
const termUrl = (clip) => `${pathToFileURL(path.join(DIR, "terminal", "replay.html")).href}?clip=${clip}`;

// ------------------------------------------------------------------ dashboard clips (no call needed)
async function c03(browser) {
  const s = await session(browser, "C03", { login: true });
  await s.page.goto(`${BASE}/`);
  await s.page.waitForSelector("[data-testid=start-call]");
  await s.click("[data-testid=profile-bright-smile-dental]", { after: 300 });
  await s.page.waitForSelector("text=Talk to Ava");
  await sleep(500);
  s.mark("start");
  await sleep(900);
  await s.click("[data-testid=profile-summit-roofing]", { after: 1800 });
  await s.click("[data-testid=profile-bright-smile-dental]", { after: 1800 });
  await s.click("[data-testid=profile-summit-roofing]", { after: 1500 });
  s.mark("end");
  await finish(s, "C03_profile_switch", s.marks.start, s.marks.end);
}

async function c09(browser) {
  const s = await session(browser, "C09", { login: true });
  // setup off camera: fresh roofing data, do-not-call list and the 15 test leads
  await s.api("POST", "/api/demo/reset", { profileId: "summit-roofing" });
  await s.context.request.post(`${BASE}/api/suppression/import`, { headers: { "content-type": "text/csv" }, data: fs.readFileSync(path.join(REPO, "seed/do-not-call.csv"), "utf8") });
  await s.context.request.post(`${BASE}/api/outbound/import?profileId=summit-roofing`, { headers: { "content-type": "text/csv" }, data: fs.readFileSync(path.join(REPO, "seed/leads.csv"), "utf8") });
  await s.page.goto(`${BASE}/outbound`);
  await s.click("[data-testid=profile-summit-roofing]", { after: 300 });
  await s.page.waitForSelector("text=Hannah Kowalski");
  await sleep(600);
  s.mark("start");
  await sleep(700);
  await s.click("[data-testid=run-list]", { after: 300 });
  await s.page.waitForSelector("text=Skipped: Number is on the do-not-call list");
  await sleep(900);
  await s.zoom("tr:has-text('Hannah Kowalski')", 1.7, 1800);
  await s.unzoom();
  await s.zoom("[data-testid=consent-log]", 1.6, 1500);
  s.mark("end");
  await finish(s, "C09_outbound_consent", s.marks.start, s.marks.end);
}

async function c12(browser) {
  const s = await session(browser, "C12", { login: true });
  await s.api("POST", "/api/demo/reset", { profileId: "summit-roofing" });
  await s.page.goto(`${BASE}/profiles`);
  await s.click("[data-testid=profile-summit-roofing]", { after: 300 });
  await s.page.waitForSelector("text=FAQs the agent can answer");
  await sleep(600);
  s.mark("start");
  await s.click("[data-testid=add-faq]", { after: 300 });
  const i = (await s.page.locator(".faq").count()) - 1;
  await s.type(`[data-testid=faq-q-${i}]`, "Do you clean gutters?", { delay: 40 });
  await s.type(`[data-testid=faq-a-${i}]`, "Yes, 149 dollars for most homes.", { delay: 32 });
  await s.click("[data-testid=close-sat]", { after: 150 });
  await s.page.locator("[data-testid=close-sat]").fill("14:00");
  await sleep(400);
  await s.click("[data-testid=save-profile]", { after: 200 });
  await s.page.waitForSelector("text=Saved.");
  await sleep(900);
  await s.zoom(`.faq:nth-child(${i + 1})`, 1.6, 1100);
  s.mark("end");
  await finish(s, "C12_edit_faqs_hours", s.marks.start, s.marks.end);
}

// ------------------------------------------------------------------ call clips (need Vapi + HTTPS)
const linesDir = path.join(DIR, "audio");
const line = (clip, n) => `${BASE}/__caller/${clip}_${String(n).padStart(2, "0")}.wav`;

async function callStatus(page) {
  return (await page.locator("[data-testid=call-status]").textContent())?.trim() ?? "";
}

/** Wait until the agent has finished speaking (status "Listening" held for `quiet` ms). */
async function waitForTurn(page, quiet = 1300, timeout = 45_000) {
  const end = Date.now() + timeout;
  let since = null;
  while (Date.now() < end) {
    const st = await callStatus(page);
    if (st === "Listening") {
      since ??= Date.now();
      if (Date.now() - since >= quiet) return;
    } else since = null;
    if (st === "Call ended" || st === "Call failed") return;
    await sleep(150);
  }
}

async function say(s, clip, n) {
  s.mark(`line${n}`);
  const dur = await s.page.evaluate((u) => window.__playLine(u), line(clip, n));
  await sleep(dur * 1000 + 300);
}

/**
 * Run a scripted browser call. `script` items: a line number (wait for the agent, then speak),
 * or { interrupt: n, after: ms } (speak line n while the agent is still talking).
 */
async function runCall(s, clip, script, startSelector = "[data-testid=start-call]") {
  await s.click(startSelector, { after: 200 });
  await s.page.waitForFunction(() => /Agent speaking|Listening/.test(document.querySelector("[data-testid=call-status]")?.textContent ?? ""), null, { timeout: 30_000 });
  s.mark("callStart");
  for (const step of script) {
    if (typeof step === "number") {
      await waitForTurn(s.page);
      await say(s, clip, step);
    } else {
      await s.page.waitForFunction(() => document.querySelector("[data-testid=call-status]")?.textContent === "Agent speaking", null, { timeout: 30_000 });
      await sleep(step.after);
      await say(s, clip, step.interrupt);
    }
  }
  await waitForTurn(s.page, 2500);
  if ((await callStatus(s.page)) !== "Call ended") await s.click("[data-testid=end-call]", { after: 500 });
  s.mark("callEnd");
  const href = await s.page.locator("a[href^='/calls/']").first().getAttribute("href", { timeout: 15_000 });
  return Number(href.split("/").pop());
}

/** Download the private call recording through the admin API once it has been processed. */
async function fetchRecording(s, callId, clip) {
  for (let i = 0; i < 60; i++) {
    const d = await (await s.api("GET", `/api/calls/${callId}`)).json();
    if (d.hasRecording) {
      const res = await s.api("GET", `/api/calls/${callId}/recording`);
      const file = path.join(RAW, `${clip}_call.mp3`);
      fs.writeFileSync(file, await res.body());
      return file;
    }
    await sleep(2000);
  }
  throw new Error(`no recording for call ${callId} after 2 minutes`);
}

/** Cut the window [from, to] (video seconds) from the call recording into clips/<clip>_audio.mp3. */
function audioFor(s, clip, recording, from, to) {
  const audioFrom = Math.max(0, from - s.marks.callStart);
  const out = path.join(DIR, `${clip}_audio.mp3`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(audioFrom), "-t", String(to - from), "-i", recording, "-c:a", "libmp3lame", "-q:a", "3", out]);
  return { file: recording, from: audioFrom };
}

async function liveCall(browser, { id, file, profile, path: pagePath = "/", setup, script, window, startSelector }) {
  const s = await session(browser, id, { login: true, callerAudio: true });
  await s.api("POST", "/api/demo/reset", { profileId: profile }).catch(() => {});
  if (setup) await setup(s);
  await s.page.goto(`${BASE}${pagePath}`);
  await s.click(`[data-testid=profile-${profile}]`, { after: 600 });
  if (s.afterNav) await s.afterNav(s);
  const callId = await runCall(s, id, script, startSelector);
  const [from, to] = window(s.marks);
  const recording = await fetchRecording(s, callId, id);
  const audio = audioFor(s, id, recording, from, to);
  await finish(s, file, from, to, audio);
  return callId;
}

async function calls(browser) {
  // C04 + C05 + C06: dental inbound enquiry to booking
  const dentalCall = await liveCall(browser, {
    id: "C04",
    file: "C04_inbound_dental",
    profile: "bright-smile-dental",
    script: [1, 2, 3, 4, 5],
    window: (m) => [m.callStart - 1, m.callStart + 14],
  });
  {
    const s = await session(browser, "C05", { login: true });
    await s.page.goto(`${BASE}/calendar`);
    await s.click("[data-testid=profile-bright-smile-dental]", { after: 300 });
    await s.page.waitForSelector("[data-testid=cal-appointment]");
    s.mark("start");
    await sleep(800);
    await s.zoom("[data-testid=cal-appointment]", 2.2, 2600);
    s.mark("end");
    await finish(s, "C05_calendar_booking", s.marks.start, s.marks.end);
  }
  {
    const s = await session(browser, "C06", { login: true });
    await s.page.goto(`${BASE}/calls`);
    await s.click("[data-testid=profile-bright-smile-dental]", { after: 300 });
    await s.page.waitForSelector(`[data-testid=call-row-${dentalCall}]`);
    s.mark("start");
    await sleep(600);
    await s.click(`[data-testid=call-row-${dentalCall}]`, { after: 300 });
    await s.page.waitForSelector("[data-testid=call-summary]");
    await sleep(800);
    await s.zoom("[data-testid=call-summary]", 1.8, 2000);
    await s.unzoom();
    await s.zoom("[data-testid=lead-fields]", 1.6, 1200);
    s.mark("end");
    await finish(s, "C06_call_log_entry", s.marks.start, s.marks.end);
  }

  // C07: caller interrupts the agent mid-sentence
  await liveCall(browser, {
    id: "C07",
    file: "C07_interruption",
    profile: "summit-roofing",
    script: [1, { interrupt: 2, after: 1600 }, 3],
    window: (m) => [m.line2 - 4, m.line2 + 6],
  });

  // C08: request for a human
  await liveCall(browser, {
    id: "C08",
    file: "C08_transfer",
    profile: "bright-smile-dental",
    script: [1, 2, 3],
    window: (m) => [m.line2 - 1, m.line2 + 7],
  });

  // C10: outbound qualification call to a consenting test lead
  await liveCall(browser, {
    id: "C10",
    file: "C10_outbound_call",
    profile: "summit-roofing",
    path: "/outbound",
    setup: async (s) => {
      await s.context.request.post(`${BASE}/api/suppression/import`, { headers: { "content-type": "text/csv" }, data: fs.readFileSync(path.join(REPO, "seed/do-not-call.csv"), "utf8") });
      await s.context.request.post(`${BASE}/api/outbound/import?profileId=summit-roofing`, { headers: { "content-type": "text/csv" }, data: fs.readFileSync(path.join(REPO, "seed/leads.csv"), "utf8") });
      await s.api("POST", "/api/outbound/run", { profileId: "summit-roofing" });
      s.afterNav = async (s) => {
        const jobs = await (await s.api("GET", "/api/outbound?profileId=summit-roofing")).json();
        const dana = jobs.find((j) => j.name === "Dana Whitfield");
        await s.click(`[data-testid=call-${dana.leadId}]`, { after: 600 });
      };
    },
    script: [1, 2, 3, 4],
    window: (m) => [m.callStart - 1, m.callStart + 11],
  });

  // C11: calendar failure, agent takes a callback request
  await liveCall(browser, {
    id: "C11",
    file: "C11_calendar_fallback",
    profile: "summit-roofing",
    setup: async (s) => {
      await s.api("POST", "/api/profiles/summit-roofing/outage", { on: true });
    },
    script: [1, 2, 3, 4],
    window: (m) => [m.line2 - 1, m.line2 + 7],
  });
  const s = await session(browser, "cleanup", { login: true });
  await s.api("POST", "/api/profiles/summit-roofing/outage", { on: false });
  await s.context.close();
  fs.rmSync(path.join(RAW, "cleanup.webm"), { force: true });
}

// ------------------------------------------------------------------ main
const JOBS = {
  C01: (b) => recordPage(b, "C01", "C01_before", cardUrl("C01_before.html"), 8),
  C02: (b) => recordPage(b, "C02", "C02_flow", cardUrl("C02_flow.html"), 10),
  C13: (b) => recordPage(b, "C13", "C13_prompt_plan", termUrl("C13"), 11, { still: false }),
  C14: (b) => recordPage(b, "C14", "C14_prompt_second_profile", termUrl("C14"), 8.5, { still: false }),
  C15: (b) => recordPage(b, "C15", "C15_safeguards", cardUrl("C15_safeguards.html"), 8),
  C16: (b) => recordPage(b, "C16", "C16_cost_estimate", cardUrl("C16_cost.html"), 8),
  C03: c03,
  C09: c09,
  C12: c12,
  calls,
};
const GROUPS = { cards: ["C01", "C02", "C15", "C16", "C13", "C14"], ui: ["C03", "C09", "C12"], calls: ["calls"] };
const wanted = process.argv.slice(2).flatMap((a) => GROUPS[a] ?? (a === "all" ? Object.values(GROUPS).flat() : [a]));
if (!wanted.length) {
  console.log("usage: node clips/record.mjs <cards|ui|calls|all|C01 ...>");
  process.exit(1);
}
if (wanted.includes("calls") && !fs.existsSync(path.join(linesDir, "C04_01.wav"))) {
  console.error("Caller audio missing: run clips/make-caller-audio.sh first");
  process.exit(1);
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"] });
try {
  for (const id of wanted) {
    if (!JOBS[id]) throw new Error(`unknown clip ${id}`);
    await JOBS[id](browser);
  }
} finally {
  await browser.close();
}
