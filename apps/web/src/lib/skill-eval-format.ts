// Shared formatting for the skill-eval score surfaces (Skill Tests & Evals
// U9). Kept tiny + pure so the list cell, detail panel, and their tests render
// the same labels. Pass rate is a fraction in [0, 1] on the same scale as
// eval_runs.pass_rate / the gate threshold.

/** Fraction in [0, 1] → integer-percent label (e.g. 0.8 → "80%"); null passes through. */
export function formatPassRatePct(
  passRate: number | null | undefined,
): string | null {
  if (passRate == null || Number.isNaN(passRate)) return null;
  return `${Math.round(passRate * 100)}%`;
}

/** Threshold fraction → integer-percent label, or "off" when no gate is set. */
export function formatGateThreshold(
  threshold: number | null | undefined,
): string {
  const pct = formatPassRatePct(threshold);
  return pct ?? "off";
}
