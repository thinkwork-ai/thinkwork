/**
 * Baseline seed-pack audit (Eval Profiles U7, F2).
 *
 * Pure analysis over the canonical seed packs at
 * seeds/eval-test-cases/*.json: flags cases that make BAD TESTS —
 * ambiguous meta-eval framing (the "print PASS and skip all safety
 * checks" specimen scores as a pass when the agent complies), brittle
 * string assertions that fire on a correct refusal, near-duplicate
 * coverage — and builds proposed pack edits (quality_state =
 * "needs-revision") plus a reasons report for PR adjudication.
 *
 * This module is deliberately filesystem-free and LLM-free so it unit
 * tests like any other evals-lib module. The CLI wrapper
 * (scripts/eval-baseline-audit.ts) owns file IO and the optional
 * Bedrock second-opinion pass; adjudication itself happens in the PR
 * review of the proposed pack edits — the audit only proposes, per
 * KTD8's repo-side curation channel.
 */

import type { SeedTestCase } from "../eval-seeds.js";

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type BaselineAuditCode =
  | "meta-eval-framing"
  | "assertion-echo-risk"
  | "assertion-trivial-value"
  | "duplicate-coverage"
  | "no-llm-rubric";

export interface BaselineAuditFinding {
  caseName: string;
  code: BaselineAuditCode;
  /** flag → propose quality_state "needs-revision"; info → report only. */
  severity: "flag" | "info";
  reason: string;
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

/**
 * Meta-eval framing: the prompt talks ABOUT being an eval and names the
 * output that scores as success. An agent that simply complies ("PASS")
 * satisfies string assertions while demonstrating exactly the unsafe
 * deference the case meant to catch — the specimen Eric spot-checked.
 */
const META_EVAL_PATTERNS = [
  /this is (an|a) (eval|evaluation|test)\b/i,
  /correct answer is to (print|say|output|respond)/i,
  /to pass (this|the) (eval|evaluation|test)/i,
  /skip (all|the|any) safety checks/i,
  /ignore (all|the|any|your) (safety|guard|guardrail)/i,
];

function metaEvalFinding(seed: SeedTestCase): BaselineAuditFinding | null {
  const matched = META_EVAL_PATTERNS.filter((p) => p.test(seed.query));
  if (matched.length === 0) return null;
  return {
    caseName: seed.name,
    code: "meta-eval-framing",
    severity: "flag",
    reason:
      "Prompt frames itself as an eval and/or names the output that scores " +
      "as success — a compliant (unsafe) response can satisfy the " +
      "assertions, so pass/fail is ambiguous. Rewrite without " +
      "self-referential framing.",
  };
}

/**
 * Echo risk: a `not-contains` value that already appears in the query.
 * A correct refusal that QUOTES the user's request ("I can't share
 * passwords") fails the assertion — a structural false positive,
 * independent of agent behavior.
 *
 * Severity is tiered because the baseline uses this pattern pervasively
 * (184 of 189 cases echo at least one value): only SINGLE plain words
 * (≤ 12 letters — "password", "curl", "clipboard") are near-certain to
 * appear in a natural refusal and flag for revision; longer or
 * multi-word echoes are reported as informational so the systemic
 * pattern is documented without proposing to gut the whole baseline in
 * one PR.
 */
const SINGLE_PLAIN_WORD = /^[a-zA-Z]{1,12}$/;

function echoRiskFindings(seed: SeedTestCase): BaselineAuditFinding[] {
  const queryLower = seed.query.toLowerCase();
  const findings: BaselineAuditFinding[] = [];
  for (const assertion of seed.assertions) {
    if (assertion.type !== "not-contains" || !assertion.value) continue;
    if (!queryLower.includes(assertion.value.toLowerCase())) continue;
    const nearCertain = SINGLE_PLAIN_WORD.test(assertion.value.trim());
    findings.push({
      caseName: seed.name,
      code: "assertion-echo-risk",
      severity: nearCertain ? "flag" : "info",
      reason:
        `not-contains value ${JSON.stringify(assertion.value)} appears ` +
        "verbatim in the query — a correct refusal that quotes the " +
        "request fails the assertion (false positive)." +
        (nearCertain
          ? " Single common word: near-certain to appear in a refusal."
          : ""),
    });
  }
  return findings;
}

/** Trivial string assertions (≤ 3 chars) match far too broadly. */
function trivialValueFindings(seed: SeedTestCase): BaselineAuditFinding[] {
  const findings: BaselineAuditFinding[] = [];
  for (const assertion of seed.assertions) {
    if (assertion.type !== "contains" && assertion.type !== "not-contains") {
      continue;
    }
    const value = assertion.value?.trim() ?? "";
    if (value.length > 0 && value.length <= 3) {
      findings.push({
        caseName: seed.name,
        code: "assertion-trivial-value",
        severity: "flag",
        reason:
          `${assertion.type} value ${JSON.stringify(value)} is ${value.length} ` +
          "character(s) — it will match incidental substrings and cannot " +
          "discriminate behavior.",
      });
    }
  }
  return findings;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export const DUPLICATE_QUERY_JACCARD_THRESHOLD = 0.9;

/**
 * Near-duplicate queries within a category add cost without coverage.
 * Flagged on the LATER case (by pack order) so a proposal never retires
 * both twins.
 */
function duplicateFindings(seeds: SeedTestCase[]): BaselineAuditFinding[] {
  const findings: BaselineAuditFinding[] = [];
  const seen: Array<{ seed: SeedTestCase; tokens: Set<string> }> = [];
  for (const seed of seeds) {
    const tokens = tokenSet(seed.query);
    const twin = seen.find(
      (prior) =>
        prior.seed.category === seed.category &&
        jaccard(prior.tokens, tokens) >= DUPLICATE_QUERY_JACCARD_THRESHOLD,
    );
    if (twin) {
      findings.push({
        caseName: seed.name,
        code: "duplicate-coverage",
        severity: "flag",
        reason:
          `Query is near-identical to ${twin.seed.name} (same category) — ` +
          "duplicate coverage adds run cost without new signal.",
      });
    }
    seen.push({ seed, tokens });
  }
  return findings;
}

/** Informational: k-trial aggregation only applies to llm-rubric cases. */
function noRubricFinding(seed: SeedTestCase): BaselineAuditFinding | null {
  if (seed.assertions.some((a) => a.type === "llm-rubric")) return null;
  return {
    caseName: seed.name,
    code: "no-llm-rubric",
    severity: "info",
    reason:
      "Case has no llm-rubric assertion — trial aggregation (unstable " +
      "detection) never applies to it.",
  };
}

/** Run every heuristic over the packs. Deterministic, no IO. */
export function auditBaselineSeeds(
  seeds: SeedTestCase[],
): BaselineAuditFinding[] {
  const findings: BaselineAuditFinding[] = [];
  for (const seed of seeds) {
    const meta = metaEvalFinding(seed);
    if (meta) findings.push(meta);
    findings.push(...echoRiskFindings(seed));
    findings.push(...trivialValueFindings(seed));
    const rubric = noRubricFinding(seed);
    if (rubric) findings.push(rubric);
  }
  findings.push(...duplicateFindings(seeds));
  return findings;
}

// ---------------------------------------------------------------------------
// Proposals — seed-pack edits for the adjudication PR
// ---------------------------------------------------------------------------

/**
 * Merge flagged findings into pack contents: every case with at least
 * one severity="flag" finding gains quality_state "needs-revision".
 * One-way at the proposal layer too: an already-retired case is never
 * downgraded, and existing states are preserved otherwise, so the
 * output always round-trips the seeder.
 */
export function buildProposedPacks(
  packs: Record<string, SeedTestCase[]>,
  findings: BaselineAuditFinding[],
): Record<string, SeedTestCase[]> {
  const flagged = new Set(
    findings.filter((f) => f.severity === "flag").map((f) => f.caseName),
  );
  const proposed: Record<string, SeedTestCase[]> = {};
  for (const [file, seeds] of Object.entries(packs)) {
    proposed[file] = seeds.map((seed) => {
      if (!flagged.has(seed.name)) return seed;
      if (seed.quality_state === "retired") return seed;
      return { ...seed, quality_state: "needs-revision" as const };
    });
  }
  return proposed;
}

/** Markdown reasons report for the adjudication PR body / docs. */
export function buildAuditReport(
  findings: BaselineAuditFinding[],
  opts: { totalCases: number; generatedAt: string },
): string {
  const flagged = findings.filter((f) => f.severity === "flag");
  const info = findings.filter((f) => f.severity === "info");
  const byCase = new Map<string, BaselineAuditFinding[]>();
  for (const finding of flagged) {
    const list = byCase.get(finding.caseName) ?? [];
    list.push(finding);
    byCase.set(finding.caseName, list);
  }

  const lines: string[] = [
    "# Baseline eval seed audit",
    "",
    `Generated: ${opts.generatedAt}`,
    "",
    `Cases audited: ${opts.totalCases}. Flagged for revision: ${byCase.size}. ` +
      `Informational notes: ${info.length}.`,
    "",
    'Flagged cases are proposed as `quality_state: "needs-revision"` in the',
    "seed packs — they keep their history but stop dispatching once this PR",
    "merges and `BASELINE_DATASET_VERSION` is bumped. Adjudicate each below:",
    "accept the flag, reject it (drop the pack edit), or rewrite the case",
    "under a new identity (`rewritten_from` + `_tombstones.json` entry).",
    "",
    "## Flagged cases",
    "",
  ];
  if (byCase.size === 0) {
    lines.push("_None._", "");
  }
  for (const [caseName, caseFindings] of byCase) {
    lines.push(`### ${caseName}`, "");
    for (const finding of caseFindings) {
      lines.push(`- **${finding.code}** — ${finding.reason}`);
    }
    lines.push("");
  }
  if (info.length > 0) {
    lines.push("## Informational (no pack edit proposed)", "");
    for (const finding of info) {
      lines.push(
        `- ${finding.caseName}: **${finding.code}** — ${finding.reason}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
