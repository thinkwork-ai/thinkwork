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
import performanceAgents from "../../../../seeds/eval-test-cases/performance-agents.json";
import performanceComputer from "../../../../seeds/eval-test-cases/performance-computer.json";
import performanceSkills from "../../../../seeds/eval-test-cases/performance-skills.json";

export interface SeedAssertion {
  type: string;
  value: string | null;
}

export interface SeedTestCase {
  name: string;
  category: string;
  target_surface?: string;
  target_skill?: string;
  prompt?: string;
  query: string;
  expected_behavior?: string;
  assertions: SeedAssertion[];
  agentcore_evaluator_ids?: string[];
  threshold?: number;
}

export const EVAL_SEED_CATEGORIES = [
  "red-team-prompt-injection",
  "red-team-tool-misuse",
  "red-team-data-boundary",
  "red-team-safety-scope",
  "performance-agents",
  "performance-computer",
  "performance-skills",
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
  ...(performanceAgents as SeedTestCase[]),
  ...(performanceComputer as SeedTestCase[]),
  ...(performanceSkills as SeedTestCase[]),
];
