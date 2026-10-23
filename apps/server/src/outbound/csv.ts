import { parse } from "csv-parse/sync";
import { toE164 } from "../util/phone.js";

export interface LeadCsvRow {
  name: string;
  phone: string | null;
  rawPhone: string;
  email: string | null;
  interest: string | null;
  consent: boolean;
}

export interface CsvParseResult {
  rows: LeadCsvRow[];
  errors: string[];
}

const YES = new Set(["yes", "y", "true", "1", "opted-in", "opted_in"]);
const NO = new Set(["no", "n", "false", "0", "", "opted-out", "opted_out"]);

/**
 * Parse a lead list. A consent column is mandatory: without one the whole file is rejected,
 * because "unknown consent" must never be treated as consent.
 */
export function parseLeadCsv(text: string): CsvParseResult {
  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true });
  } catch (e) {
    return { rows: [], errors: [`Could not read CSV: ${(e as Error).message}`] };
  }
  if (!records.length) return { rows: [], errors: ["The file has no rows"] };
  const cols = Object.keys(records[0]);
  const missing = ["name", "phone", "consent"].filter((c) => !cols.includes(c));
  if (missing.length) return { rows: [], errors: [`Missing required column(s): ${missing.join(", ")}`] };

  const rows: LeadCsvRow[] = [];
  const errors: string[] = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const consentRaw = (r.consent ?? "").toLowerCase();
    if (!YES.has(consentRaw) && !NO.has(consentRaw)) {
      errors.push(`Row ${line}: consent must be yes or no (got "${r.consent}"); treated as no`);
    }
    if (!r.name) {
      errors.push(`Row ${line}: missing name, skipped`);
      return;
    }
    rows.push({
      name: r.name,
      rawPhone: r.phone ?? "",
      phone: toE164(r.phone),
      email: r.email || null,
      interest: r.interest || null,
      consent: YES.has(consentRaw),
    });
  });
  return { rows, errors };
}

export function parseSuppressionCsv(text: string): { phones: { phone: string; reason: string }[]; errors: string[] } {
  const records = parse(text, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true }) as Record<
    string,
    string
  >[];
  const phones: { phone: string; reason: string }[] = [];
  const errors: string[] = [];
  records.forEach((r, i) => {
    const e164 = toE164(r.phone);
    if (!e164) errors.push(`Row ${i + 2}: invalid phone "${r.phone}"`);
    else phones.push({ phone: e164, reason: r.reason || "Do-not-call list" });
  });
  return { phones, errors };
}
