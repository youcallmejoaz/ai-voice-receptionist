/** Reset profiles from the JSON files (discarding dashboard edits) and load the do-not-call list. */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { createContext } from "../context.js";
import { importSuppression } from "../outbound/dialer.js";
import { loadProfilesFromDir } from "../profiles/loader.js";
import { listProfiles, seedProfiles } from "../profiles/store.js";

const cfg = loadConfig();
const ctx = createContext(cfg);
seedProfiles(ctx.db, loadProfilesFromDir(cfg.profilesDir), true);
for (const s of listProfiles(ctx.db)) ctx.mockCalendar.ensureSlots(s.profile);
const dnc = path.join(cfg.repoRoot, "seed/do-not-call.csv");
if (fs.existsSync(dnc)) console.log("do-not-call list:", importSuppression(ctx, fs.readFileSync(dnc, "utf8")));
console.log(`seeded ${listProfiles(ctx.db).length} profiles into ${cfg.databasePath}`);
