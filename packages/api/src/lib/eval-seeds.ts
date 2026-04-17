/**
 * Aggregates the per-category JSON files at seeds/eval-test-cases/*.json
 * into a single array consumed by the seedEvalTestCases resolver and the
 * auto-seed path inside evalTestCases. esbuild bundles each JSON import
 * into the graphql-http Lambda artifact at build time.
 *
 * Adding a new category: drop a JSON file in the seeds directory, add
 * one import line below, and append it to EVAL_SEEDS. See
 * seeds/eval-test-cases/README.md for the file shape.
 */

import emailCalendar from "../../../../seeds/eval-test-cases/email-calendar.json";
import knowledgeBase from "../../../../seeds/eval-test-cases/knowledge-base.json";
import mcpGateway from "../../../../seeds/eval-test-cases/mcp-gateway.json";
import redTeam from "../../../../seeds/eval-test-cases/red-team.json";
import subAgents from "../../../../seeds/eval-test-cases/sub-agents.json";
import threadManagement from "../../../../seeds/eval-test-cases/thread-management.json";
import toolSafety from "../../../../seeds/eval-test-cases/tool-safety.json";
import workspaceMemory from "../../../../seeds/eval-test-cases/workspace-memory.json";
import workspaceRouting from "../../../../seeds/eval-test-cases/workspace-routing.json";

export interface SeedAssertion {
	type: string;
	value: string | null;
}

export interface SeedTestCase {
	name: string;
	category: string;
	query: string;
	assertions: SeedAssertion[];
}

export const EVAL_SEED_CATEGORIES = [
	"email-calendar",
	"knowledge-base",
	"mcp-gateway",
	"red-team",
	"sub-agents",
	"thread-management",
	"tool-safety",
	"workspace-memory",
	"workspace-routing",
] as const;

export const EVAL_SEEDS: SeedTestCase[] = [
	...(emailCalendar as SeedTestCase[]),
	...(knowledgeBase as SeedTestCase[]),
	...(mcpGateway as SeedTestCase[]),
	...(redTeam as SeedTestCase[]),
	...(subAgents as SeedTestCase[]),
	...(threadManagement as SeedTestCase[]),
	...(toolSafety as SeedTestCase[]),
	...(workspaceMemory as SeedTestCase[]),
	...(workspaceRouting as SeedTestCase[]),
];
