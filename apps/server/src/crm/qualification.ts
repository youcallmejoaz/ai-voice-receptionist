import type { BusinessProfile, QualificationRule } from "../profiles/schema.js";

export interface QualificationResult {
  /** true = fits, false = not a fit, null = not enough answers yet */
  qualified: boolean | null;
  missing: string[];
  failedReasons: string[];
}

const norm = (v: string) => v.trim().toLowerCase();

function passes(rule: QualificationRule, answer: string): boolean {
  const a = norm(answer);
  const values = (Array.isArray(rule.value) ? rule.value : [rule.value]).map(norm);
  switch (rule.op) {
    case "equals":
      return a === values[0];
    case "notEquals":
      return a !== values[0];
    case "in":
      return values.includes(a);
    case "notIn":
      return !values.includes(a);
    case "startsWithAny":
      return values.some((v) => a.startsWith(v));
  }
}

/** Apply the profile's qualification rules to the caller's answers. Rules on unanswered fields are skipped. */
export function evaluateQualification(profile: BusinessProfile, answers: Record<string, string>): QualificationResult {
  const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
  const failedReasons = profile.qualification.rules
    .filter((r) => r.field in clean && !passes(r, clean[r.field]))
    .map((r) => r.failReason);
  const missing = profile.qualification.questions.filter((q) => q.required && !(q.field in clean)).map((q) => q.field);
  if (failedReasons.length) return { qualified: false, missing, failedReasons };
  return { qualified: missing.length ? null : true, missing, failedReasons };
}
