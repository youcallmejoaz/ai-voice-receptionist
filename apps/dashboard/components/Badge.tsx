import { OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/api";

export function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="badge grey">In progress</span>;
  return <span className={`badge ${OUTCOME_TONE[outcome] ?? "grey"}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>;
}
