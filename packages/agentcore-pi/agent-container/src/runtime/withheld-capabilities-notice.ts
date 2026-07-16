/**
 * Withheld-capability context surfacing (THINK-302 U13 — R30).
 *
 * The compiled manifest's `withheld` section lists grants the render
 * decided not to activate (drift, unsigned/unapproved, approval-gated,
 * collision, …). The model never registers those tools, so without a
 * notice it cannot tell a capability is *pending re-approval* from one that
 * never existed — and may confabulate about a "missing" tool. This renders
 * a compact, bounded block naming each withheld slug + reason + a one-line
 * remedy hint, mirroring the delegated `withheld_connections` notice.
 *
 * Bounded by design: caps the entry count and appends an overflow tally so
 * a large withheld set can never balloon the system prompt.
 */

const MAX_WITHHELD_ENTRIES = 12;

/** One-line, model-facing remedy hint per withheld reason. */
const REASON_HINT: Record<string, string> = {
  definition_drift: "edited since approval — pending re-approval",
  unsigned: "not yet approved — pending operator approval",
  approval_gated: "requires per-use approval — ask before relying on it",
  trust_gate: "failed the trust scan — pending re-approval",
  invalid_definition: "definition is invalid — needs a fix before it loads",
  collision: "name conflicts with another tool — not loaded",
  disabled: "currently disabled",
  missing_connection: "its connection is not active",
  operation_not_permitted: "the requested operation is not granted",
  policy_blocked: "blocked by workspace policy",
  missing_skill: "the backing skill is not installed",
  nested_agent_folder: "unsupported nested sub-agent folder",
  invalid_signature: "signature invalid — pending re-approval",
};

interface WithheldLike {
  slug?: unknown;
  class?: unknown;
  reason?: unknown;
}

function hintFor(reason: string): string {
  return REASON_HINT[reason] ?? "unavailable this turn";
}

/**
 * Build the withheld-capabilities notice, or `""` when nothing is withheld.
 * Tolerant of the loose `Array<Record<string, unknown>>` manifest shape:
 * entries missing a slug/reason are skipped rather than rendered blank.
 */
export function formatWithheldCapabilitiesNotice(
  withheld: readonly WithheldLike[] | null | undefined,
): string {
  if (!withheld || withheld.length === 0) return "";
  const usable = withheld.filter(
    (entry) =>
      typeof entry.slug === "string" && typeof entry.reason === "string",
  );
  if (usable.length === 0) return "";

  const shown = usable.slice(0, MAX_WITHHELD_ENTRIES);
  const lines = shown.map((entry) => {
    const slug = entry.slug as string;
    const reason = entry.reason as string;
    const klass = typeof entry.class === "string" ? `${entry.class} ` : "";
    return `- ${klass}${slug}: ${reason} (${hintFor(reason)})`;
  });
  const overflow = usable.length - shown.length;
  if (overflow > 0) {
    lines.push(
      `- …and ${overflow} more withheld capabilit${
        overflow === 1 ? "y" : "ies"
      }.`,
    );
  }
  return [
    "CAPABILITY NOTICE — capabilities currently WITHHELD (not loaded this turn):",
    ...lines,
    "If asked to use one, say it is pending/unavailable and why — do NOT " +
      "invent or reconstruct what its tool would have returned.",
  ].join("\n");
}
