/**
 * GraphQL Contract Tests
 *
 * Validates that the canonical GraphQL schema in packages/database-pg/graphql/
 * is parseable, contains all expected v1 types, and that the subscription-only
 * fragment (terraform/schema.graphql) is a valid subset.
 *
 * These are structural contract tests — they verify the schema surface, not
 * runtime behavior. Runtime contract tests against a deployed stack come in
 * Phase 10 (pre-launch hardening).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { buildSchema, parse, print } from "graphql";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCHEMA_DIR = join(REPO_ROOT, "packages/database-pg/graphql");
const TYPES_DIR = join(SCHEMA_DIR, "types");
const TF_SCHEMA = join(REPO_ROOT, "terraform/schema.graphql");

// AWS AppSync custom directives — needed so buildSchema doesn't reject @aws_subscribe
const APPSYNC_DIRECTIVES = `
directive @aws_subscribe(mutations: [String!]!) on FIELD_DEFINITION
directive @aws_auth(cognito_groups: [String!]!) on FIELD_DEFINITION
directive @aws_api_key on FIELD_DEFINITION | OBJECT
directive @aws_iam on FIELD_DEFINITION | OBJECT
directive @aws_cognito_user_pools(cognito_groups: [String!]) on FIELD_DEFINITION | OBJECT
`;

function loadFullSchema(): string {
	const base = readFileSync(join(SCHEMA_DIR, "schema.graphql"), "utf-8");
	const typeFiles = readdirSync(TYPES_DIR)
		.filter((f) => f.endsWith(".graphql"))
		.sort();
	const types = typeFiles.map((f) => readFileSync(join(TYPES_DIR, f), "utf-8"));
	return [APPSYNC_DIRECTIVES, base, ...types].join("\n\n");
}

function loadTfSchema(): string {
	const sdl = readFileSync(TF_SCHEMA, "utf-8");
	return [APPSYNC_DIRECTIVES, sdl].join("\n\n");
}

describe("GraphQL Schema Contract", () => {
	it("full canonical schema is parseable", () => {
		const sdl = loadFullSchema();
		expect(() => buildSchema(sdl)).not.toThrow();
	});

	it("terraform subscription-only schema is parseable", () => {
		expect(() => buildSchema(loadTfSchema())).not.toThrow();
	});

	describe("v1 Query surface", () => {
		const schema = buildSchema(loadFullSchema());
		const queryType = schema.getQueryType();
		const queryFields = queryType ? Object.keys(queryType.getFields()) : [];

		const expectedQueries = [
			// Agents
			"agent", "agents", "agentApiKeys", "modelCatalog",
			// Threads
			"thread", "threads", "threadsPaged", "threadByNumber", "threadLabels",
			// Messages
			"messages",
			// Core
			"me", "tenant", "tenantBySlug", "tenantMembers", "user",
			// Teams
			"team", "teams",
			// Triggers
			"routines", "routine", "routineRun", "routineRuns",
			"scheduledJobs", "scheduledJob",
			"threadTurns", "threadTurn", "threadTurnEvents",
			// Costs
			"costSummary", "costByAgent", "costByModel",
			"budgetPolicies", "budgetStatus", "agentBudgetStatus",
			// Knowledge
			"knowledgeBases", "knowledgeBase",
			// Memory
			"memoryRecords", "memorySearch",
			// Inbox
			"inboxItems", "inboxItem", "activityLog",
			// Templates
			"agentTemplates", "agentTemplate", "agentVersions",
			// Webhooks
			"webhooks", "webhook",
			// Artifacts
			"artifacts", "artifact",
		];

		for (const q of expectedQueries) {
			it(`has Query.${q}`, () => {
				expect(queryFields).toContain(q);
			});
		}
	});

	describe("v1 Mutation surface", () => {
		const schema = buildSchema(loadFullSchema());
		const mutationType = schema.getMutationType();
		const mutationFields = mutationType ? Object.keys(mutationType.getFields()) : [];

		const expectedMutations = [
			// Agents
			"createAgent", "updateAgent", "deleteAgent",
			"setAgentCapabilities", "setAgentSkills",
			// Threads
			"createThread", "updateThread", "deleteThread",
			// Messages
			"sendMessage", "deleteMessage",
			// Templates
			"createAgentTemplate", "updateAgentTemplate", "deleteAgentTemplate",
			"createAgentFromTemplate",
			// Knowledge
			"createKnowledgeBase", "deleteKnowledgeBase", "syncKnowledgeBase",
			// Memory
			"deleteMemoryRecord", "updateMemoryRecord",
			// Inbox
			"createInboxItem", "approveInboxItem", "rejectInboxItem",
		];

		for (const m of expectedMutations) {
			it(`has Mutation.${m}`, () => {
				expect(mutationFields).toContain(m);
			});
		}
	});

	describe("v1 Subscription surface", () => {
		const schema = buildSchema(loadFullSchema());
		const subscriptionType = schema.getSubscriptionType();
		const subFields = subscriptionType ? Object.keys(subscriptionType.getFields()) : [];

		const expectedSubscriptions = [
			"onAgentStatusChanged",
			"onNewMessage",
			"onHeartbeatActivity",
			"onThreadUpdated",
			"onInboxItemStatusChanged",
			"onThreadTurnUpdated",
			"onOrgUpdated",
			"onCostRecorded",
		];

		for (const s of expectedSubscriptions) {
			it(`has Subscription.${s}`, () => {
				expect(subFields).toContain(s);
			});
		}

		const cutSubscriptions = [
			"onEvalRunUpdated",
		];

		for (const s of cutSubscriptions) {
			it(`does NOT have cut Subscription.${s}`, () => {
				expect(subFields).not.toContain(s);
			});
		}
	});

	describe("cut features are absent", () => {
		const sdl = loadFullSchema();

		it("no autoresearch types", () => {
			expect(sdl).not.toContain("AutoResearch");
			expect(sdl).not.toContain("autoResearch");
		});

		it("no ontology types", () => {
			expect(sdl).not.toContain("OntologyNodeType");
			expect(sdl).not.toContain("OntologyEdgeType");
			expect(sdl).not.toContain("ontologyNodeTypes");
		});

		it("no eval types", () => {
			expect(sdl).not.toContain("EvalRun");
			expect(sdl).not.toContain("EvalTestCase");
			expect(sdl).not.toContain("evalRuns");
		});

		it("no KG extract", () => {
			expect(sdl).not.toContain("triggerKGExtract");
			expect(sdl).not.toContain("memoryGraph");
		});
	});

	describe("terraform schema is subscription-only subset", () => {
		const tfSchema = buildSchema(loadTfSchema());

		it("has Subscription type", () => {
			expect(tfSchema.getSubscriptionType()).toBeTruthy();
		});

		it("has notification Mutation fields", () => {
			const mutationType = tfSchema.getMutationType();
			const fields = mutationType ? Object.keys(mutationType.getFields()) : [];
			expect(fields).toContain("notifyAgentStatus");
			expect(fields).toContain("notifyNewMessage");
			expect(fields).toContain("notifyThreadUpdate");
		});

		it("does NOT have product Query fields", () => {
			const queryType = tfSchema.getQueryType();
			const fields = queryType ? Object.keys(queryType.getFields()) : [];
			// Should only have _empty placeholder
			expect(fields).toEqual(["_empty"]);
		});
	});
});
