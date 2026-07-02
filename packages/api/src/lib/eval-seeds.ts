/**
 * Aggregates the per-category JSON files at seeds/eval-test-cases/*.json
 * into a single array consumed by the seedEvalTestCases resolver and the
 * auto-seed path inside evalTestCases. esbuild bundles each JSON import
 * into the graphql-http Lambda artifact at build time.
 *
 * Adding a new pack file: drop a JSON file in the seeds directory, add
 * one import line below, and append it to EVAL_SEEDS. See
 * seeds/eval-test-cases/README.md for the file shape.
 */

import redTeamAgentsPromptInjection from "../../../../seeds/eval-test-cases/red-team-agents-prompt-injection.json";
import redTeamAgentsToolMisuse from "../../../../seeds/eval-test-cases/red-team-agents-tool-misuse.json";
import redTeamAgentsDataBoundary from "../../../../seeds/eval-test-cases/red-team-agents-data-boundary.json";
import redTeamAgentsSafetyScope from "../../../../seeds/eval-test-cases/red-team-agents-safety-scope.json";
import redTeamComputerPromptInjection from "../../../../seeds/eval-test-cases/red-team-computer-prompt-injection.json";
import redTeamComputerToolMisuse from "../../../../seeds/eval-test-cases/red-team-computer-tool-misuse.json";
import redTeamComputerDataBoundary from "../../../../seeds/eval-test-cases/red-team-computer-data-boundary.json";
import redTeamComputerSafetyScope from "../../../../seeds/eval-test-cases/red-team-computer-safety-scope.json";
import redTeamSkillGithub from "../../../../seeds/eval-test-cases/red-team-skill-github.json";
import redTeamSkillFilesystem from "../../../../seeds/eval-test-cases/red-team-skill-filesystem.json";
import redTeamSkillWorkspace from "../../../../seeds/eval-test-cases/red-team-skill-workspace.json";
import seedTombstones from "../../../../seeds/eval-test-cases/_tombstones.json";

export interface SeedAssertion {
  type: string;
  value: string | null;
}

/** Curation disposition carried by seed-pack cases (Eval Profiles U7). */
export type SeedQualityState = "active" | "retired" | "needs-revision";

export interface SeedTestCase {
  name: string;
  category: string;
  target_surface?: string;
  target_skill?: string;
  desktop_pi_compatible?: boolean;
  desktop_pi_target?: string;
  desktop_pi_tooling?: string;
  desktop_pi_credentials?: string;
  tags?: string[];
  prompt?: string;
  query: string;
  expected_behavior?: string;
  assertions: SeedAssertion[];
  agentcore_evaluator_ids?: string[];
  threshold?: number;
  /**
   * Curation state (U7 / KTD8). Missing = "active". The seeder
   * propagates transitions one-way per tenant (never retired → active);
   * non-active cases keep their result history but never dispatch.
   */
  quality_state?: SeedQualityState;
  /**
   * Rewrite linkage (R14): the case `name` this case supersedes. The
   * predecessor id must appear in _tombstones.json so tenants tombstone
   * the old identity while gaining this one.
   */
  rewritten_from?: string;
}

/**
 * Pack-level tombstone (U7): a case id removed from the canonical packs
 * — usually because a rewrite minted a successor identity
 * (`rewritten_to`). The seeder moves the id from each tenant manifest's
 * live cases to its tombstones; the index row survives disabled so
 * historical eval_results keep resolving.
 */
export interface SeedTombstone {
  case_id: string;
  /** Successor case name when the removal was a rewrite; null otherwise. */
  rewritten_to?: string | null;
  reason?: string;
}

export const EVAL_SEED_TOMBSTONES: SeedTombstone[] =
  seedTombstones as SeedTombstone[];

export const BUILT_IN_EVAL_SEED_SOURCE = "yaml-seed" as const;
export const CUSTOMER_OVERLAY_EVAL_SOURCE = "customer-overlay" as const;

export const EVAL_SEED_CATEGORIES = [
  "red-team-prompt-injection",
  "red-team-tool-misuse",
  "red-team-data-boundary",
  "red-team-safety-scope",
] as const;

export const EVAL_SEEDS: SeedTestCase[] = [
  ...(redTeamAgentsPromptInjection as SeedTestCase[]),
  ...(redTeamAgentsToolMisuse as SeedTestCase[]),
  ...(redTeamAgentsDataBoundary as SeedTestCase[]),
  ...(redTeamAgentsSafetyScope as SeedTestCase[]),
  ...(redTeamComputerPromptInjection as SeedTestCase[]),
  ...(redTeamComputerToolMisuse as SeedTestCase[]),
  ...(redTeamComputerDataBoundary as SeedTestCase[]),
  ...(redTeamComputerSafetyScope as SeedTestCase[]),
  ...(redTeamSkillGithub as SeedTestCase[]),
  ...(redTeamSkillFilesystem as SeedTestCase[]),
  ...(redTeamSkillWorkspace as SeedTestCase[]),
];
