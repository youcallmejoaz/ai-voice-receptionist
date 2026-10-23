/**
 * Normalise a phone number to E.164 so consent and do-not-call checks compare like with like.
 * "(555) 010-0123", "555.010.0123" and "+1 555 010 0123" all become "+15550100123".
 * Returns null when the input cannot be a valid number.
 */
export function toE164(raw: string | null | undefined, defaultCountry = "1"): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountry)) return `+${digits}`;
  return null;
}

/** Last four digits, for logs and UI where the full number should not be shown. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "unknown";
  return `•••${e164.slice(-4)}`;
}
