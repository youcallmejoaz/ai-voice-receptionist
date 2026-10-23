import type { AppContext } from "./context.js";
import { loadProfilesFromDir } from "./profiles/loader.js";
import { listProfiles, seedProfiles } from "./profiles/store.js";
import { syncAssistant } from "./routes/assistant-sync.js";

/** Load profile files (dashboard edits in the DB are kept), keep a week of mock slots, sync assistants. */
export async function bootstrap(app: AppContext, { sync = true } = {}) {
  seedProfiles(app.db, loadProfilesFromDir(app.cfg.profilesDir));
  for (const s of listProfiles(app.db)) app.mockCalendar.ensureSlots(s.profile, app.now());

  if (sync && app.vapi && app.cfg.publicBaseUrl.startsWith("https://")) {
    for (const s of listProfiles(app.db)) {
      try {
        const id = await syncAssistant(app, s.profile.id);
        console.log(`synced ${s.profile.id} -> Vapi assistant ${id}`);
      } catch (e) {
        console.error(`Vapi sync failed for ${s.profile.id}: ${(e as Error).message}`);
      }
    }
  } else if (sync) {
    console.log("Vapi sync skipped (needs VAPI_PRIVATE_KEY and an https PUBLIC_BASE_URL)");
  }
}
