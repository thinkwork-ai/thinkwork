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
			"unreadThreadCount",
			// Messages
			"messages",
			// Core
			"me", "tenant", "tenantBySlug", "tenantMembers", "user",
			// Teams
			"team", "teams",
			// Triggers
			"routines", "routine",
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
			// Added in the evals migration (PR #147 — Phase 2 wires this
			// subscription via @aws_subscribe so the Studio + dashboard
			// live-update while the eval-runner Lambda processes a run).
			"onEvalRunUpdated",
		];

		for (const s of expectedSubscriptions) {
			it(`has Subscription.${s}`, () => {
				expect(subFields).toContain(s);
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

		// Eval types were originally cut from v1 but landed in PR #147
		// (Evaluations migration from maniflow). Sanity-check the schema
		// does carry the surface the Studio + eval-runner depend on.
		it("has eval types", () => {
			expect(sdl).toContain("type EvalRun");
			expect(sdl).toContain("type EvalTestCase");
			expect(sdl).toContain("evalRuns(");
			expect(sdl).toContain("startEvalRun(");
		});

		it("no KG extract mutation", () => {
			expect(sdl).not.toContain("triggerKGExtract");
		});
	});

	describe("0.2.0 SDK surface additions", () => {
		const schema = buildSchema(loadFullSchema());

		it("ThreadChannel includes connector-created work", () => {
			const enumType = schema.getType("ThreadChannel");
			expect(enumType).toBeDefined();
			const values = (enumType as any)
				.getValues()
				.map((value: { name: string }) => value.name);
			expect(values).toContain("CONNECTOR");
			expect(values).toContain("SLACK");
		});

		it("CreateThreadInput accepts firstMessage for atomic create-and-send", () => {
			const inputType = schema.getType("CreateThreadInput");
			expect(inputType).toBeDefined();
			const fields = (inputType as any).getFields();
			expect(fields.firstMessage).toBeDefined();
			expect(String(fields.firstMessage.type)).toBe("String");
		});

		it("unreadThreadCount returns a non-null Int", () => {
			const queryType = schema.getQueryType();
			const field = queryType!.getFields().unreadThreadCount;
			expect(field).toBeDefined();
			expect(String(field.type)).toBe("Int!");
			const argNames = field.args.map((a) => a.name).sort();
			expect(argNames).toEqual(["agentId", "tenantId"]);
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
			expect(fields).toContain("publishComputerThreadChunk");
		});

		it("has Computer thread chunk subscription contract", () => {
			const mutationType = tfSchema.getMutationType();
			const subscriptionType = tfSchema.getSubscriptionType();
			const eventType = tfSchema.getType("ComputerThreadChunkEvent") as any;

			expect(eventType).toBeDefined();
			expect(Object.keys(eventType.getFields())).toEqual([
				"threadId",
				"chunk",
				"seq",
				"publishedAt",
			]);
			expect(mutationType?.getFields().publishComputerThreadChunk).toBeDefined();
			expect(subscriptionType?.getFields().onComputerThreadChunk).toBeDefined();
		});

		it("does NOT have product Query fields", () => {
			const queryType = tfSchema.getQueryType();
			const fields = queryType ? Object.keys(queryType.getFields()) : [];
			// Should only have _empty placeholder
			expect(fields).toEqual(["_empty"]);
		});
	});
});
