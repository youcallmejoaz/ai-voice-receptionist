import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BusinessProfile } from "./schema.js";

export class ProfileValidationError extends Error {
  constructor(
    public readonly source: string,
    public readonly issues: string[],
  ) {
    super(`Invalid business profile (${source}):\n  - ${issues.join("\n  - ")}`);
  }
}

export function parseProfile(data: unknown, source = "input"): BusinessProfile {
  const result = BusinessProfile.safeParse(data);
  if (!result.success) {
    throw new ProfileValidationError(
      source,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const profile = result.data;
  for (const [day, h] of Object.entries(profile.hours)) {
    if (h && h.open >= h.close) throw new ProfileValidationError(source, [`hours.${day}: open must be before close`]);
  }
  return profile;
}

/** Load every *.json profile in a directory. Fails loudly on the first invalid file. */
export function loadProfilesFromDir(dir: string): BusinessProfile[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const profiles = files.map((f) => {
    const full = path.join(dir, f);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      throw new ProfileValidationError(f, [`not valid JSON: ${(e as Error).message}`]);
    }
    return parseProfile(raw, f);
  });
  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id)) throw new ProfileValidationError(p.id, ["duplicate profile id"]);
    ids.add(p.id);
  }
  return profiles;
}

/** Partial edits from the dashboard (FAQs, hours, ...) merged and re-validated. */
export const ProfilePatch = BusinessProfile.partial().omit({ id: true });
export type ProfilePatch = z.infer<typeof ProfilePatch>;
