/**
 * Placeholder-aware comparator (Unit 10).
 *
 * Given a file that sits at an agent's S3 prefix and the corresponding raw
 * template content, decide whether the agent's file is a "bootstrap fork"
 * (safe to delete — the overlay composer will serve identical content by
 * walking the template chain) or a "meaningful override" (keep — the
 * operator deliberately customized this file).
 *
 * The naive byte-compare fails because the pre-overlay bootstrap path
 * wrote SUBSTITUTED content to S3 — the agent file has "Hi Marco" where
 * the template has "Hi {{AGENT_NAME}}". So we forward-substitute the
 * template with the agent's real placeholder values and compare the
 * rendered result to the agent content.
 *
 * Classifications:
 *   - `fork`            → bootstrap-forked copy; safe to delete.
 *   - `override`        → meaningfully different; keep as agent override.
 *   - `review-required` → agent's name is a common noun that appears in
 *                         the template's own prose, so a byte-match is
 *                         not conclusive. Operator must inspect.
 *   - `no-template`     → file present only at agent layer; keep as
 *                         override (could be an operator-created file
 *                         like docs/procedures/*.md).
 */

import {
  type HumanPlaceholderValues,
  type PlaceholderValues,
  substitute,
  substituteHumans,
} from "./placeholder-substitution.js";

/**
 * Agent names that, when substituted into template prose, are likely to
 * produce incidental byte-matches even for non-forked files. The English
 * word "Assistant" appearing inside template prose would be indistinguish-
 * able from a substituted `{{AGENT_NAME}}` for an agent literally named
 * "Assistant", so we flag those for human review rather than auto-deleting.
 *
 * Kept in sync with the plan's Unit 10 ambiguous-name shortlist.
 */
export const AMBIGUOUS_AGENT_NAMES: readonly string[] = [
  "assistant",
  "agent",
  "user",
  "admin",
  "bot",
  "memory",
  "default",
  "test",
];

export function isAmbiguousAgentName(name: string | null | undefined): boolean {
  if (!name) return false;
  return AMBIGUOUS_AGENT_NAMES.includes(name.trim().toLowerCase());
}

export type ClassificationKind =
  | "fork"
  | "override"
  | "review-required"
  | "no-template";

export interface ClassificationResult {
  kind: ClassificationKind;
  /**
   * Short human-readable summary of WHY this classification. Lands in
   * the dry-run report.
   */
  reason: string;
  /**
   * Sha256 of the rendered-template bytes (hex). Set when the template
   * side of the comparison was available — useful for reproducibility
   * audits after the commit phase.
   */
  renderedSha256?: string;
  /**
   * Number of bytes that differ between agent content and the rendered
   * template. Zero means the comparison matched; populated for both
   * matches and near-matches so the dry-run report surfaces "off by 3
   * bytes" cases the operator should eyeball.
   */
  byteDelta?: number;
}

export interface ClassifyFileInput {
  agentContent: string | null;
  /**
   * Raw template bytes WITH placeholders intact. If null, the file
   * only exists at the agent layer and is classified `no-template`.
   */
  templateContent: string | null;
  /**
   * Materializer-set values (AGENT_NAME, TENANT_NAME) to substitute into
   * the template before comparing. Resolved from the agent's current DB
   * state.
   */
  values: PlaceholderValues;
  /**
   * USER.md HUMAN_* values to substitute into the template. Required
   * when comparing files that contain {{HUMAN_*}} tokens (USER.md and
   * its bootstrap-forked descendants); omitted for any non-USER.md
   * comparison since those templates contain no HUMAN_* tokens.
   */
  humanValues?: HumanPlaceholderValues;
  /**
   * The agent's `name` column. Used to flag ambiguous-name cases. If
   * undefined, ambiguous-name check is skipped.
   */
  agentName?: string | null;
}

function trimTrailingWhitespace(s: string): string {
  // The pre-overlay bootstrap path wrote content as-is; some editors
  // since-then have normalized trailing whitespace on saves. Compare
  // after a light trim so whitespace churn doesn't defeat the match.
  return s.replace(/[ \t]+$/gm, "").replace(/\n+$/, "\n");
}

function countByteDelta(a: string, b: string): number {
  // Cheap approximation: count characters that differ in the aligned
  // prefix, plus length difference. Good enough for a report.
  const minLen = Math.min(a.length, b.length);
  let diff = 0;
  for (let i = 0; i < minLen; i++) if (a[i] !== b[i]) diff++;
  diff += Math.abs(a.length - b.length);
  return diff;
}

/**
 * Classify one agent-scoped S3 file.
 *
 * The caller supplies the raw template-layer bytes (pre-substitution)
 * and the per-agent placeholder values; this helper does the forward-
 * substitute + compare + classify.
 */
export function classifyAgentFile(
  input: ClassifyFileInput,
): ClassificationResult {
  const agentContent = input.agentContent ?? "";

  if (input.templateContent === null) {
    return {
      kind: "no-template",
      reason:
        "File exists only at the agent layer (not in template or defaults). Treated as a bona-fide override.",
    };
  }

  // Render the template with the agent's values and compare. Two passes
  // mirror the USER.md write path: AGENT_NAME / TENANT_NAME first, then
  // (if humanValues was supplied) the HUMAN_* set. A file the
  // materializer would have rendered identically matches, and files the
  // renderer would have changed (e.g. because an em-dash rule applies)
  // don't accidentally classify as forks.
  const afterMaterializer = substitute(input.values, input.templateContent);
  const rendered = input.humanValues
    ? substituteHumans(input.humanValues, afterMaterializer)
    : afterMaterializer;
  const normalizedAgent = trimTrailingWhitespace(agentContent);
  const normalizedRendered = trimTrailingWhitespace(rendered);

  if (normalizedAgent === normalizedRendered) {
    if (isAmbiguousAgentName(input.agentName)) {
      return {
        kind: "review-required",
        reason: `Agent name '${input.agentName}' is a common noun that may incidentally match template prose; operator should eyeball before auto-deleting.`,
        byteDelta: 0,
      };
    }
    return {
      kind: "fork",
      reason:
        "Agent content matches forward-substituted template byte-for-byte — this is the bootstrap-era forked copy.",
      byteDelta: 0,
    };
  }

  return {
    kind: "override",
    reason:
      "Agent content differs from the forward-substituted template — operator customization. Keep.",
    byteDelta: countByteDelta(normalizedAgent, normalizedRendered),
  };
}
