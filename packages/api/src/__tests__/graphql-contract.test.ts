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
      "agent",
      "agents",
      "agentApiKeys",
      "modelCatalog",
      // Threads
      "thread",
      "threads",
      "threadsPaged",
      "threadByNumber",
      "threadLabels",
      "unreadThreadCount",
      // Spaces
      "spaces",
      "space",
      "customerOnboardingSpace",
      "threadLinkedTasks",
      // Messages
      "messages",
      // Core
      "me",
      "tenant",
      "tenantBySlug",
      "tenantMembers",
      "user",
      // Teams
      "team",
      "teams",
      // Triggers
      "routines",
      "routine",
      "scheduledJobs",
      "scheduledJob",
      "threadTurns",
      "threadTurn",
      "threadTurnEvents",
      // Costs
      "costSummary",
      "costByAgent",
      "costByModel",
      "budgetPolicies",
      "budgetStatus",
      "agentBudgetStatus",
      // Knowledge
      "knowledgeBases",
      "knowledgeBase",
      // Memory
      "memoryRecords",
      "memorySearch",
      // Ontology
      "ontologyDefinitions",
      "ontologyChangeSets",
      "ontologySuggestionScanJob",
      "ontologyReprocessJob",
      // Inbox
      "inboxItems",
      "inboxItem",
      "activityLog",
      // Webhooks
      "webhooks",
      "webhook",
      // Artifacts
      "artifacts",
      "artifact",
    ];

    for (const q of expectedQueries) {
      it(`has Query.${q}`, () => {
        expect(queryFields).toContain(q);
      });
    }
  });

  describe("Spaces contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("exposes space-local agent instructions separately from global agent prompt", () => {
      const space = schema.getType("Space");
      const assignment = schema.getType("SpaceAgentAssignment");
      expect(space?.toString()).toBe("Space");
      expect(assignment?.toString()).toBe("SpaceAgentAssignment");
      expect(
        (assignment as any).getFields().localInstructions.type.toString(),
      ).toBe("String");
      expect((assignment as any).getFields().localRole.type.toString()).toBe(
        "String",
      );
      expect((assignment as any).getFields().agent.type.toString()).toBe(
        "Agent",
      );
    });

    it("exposes contextual workroom configuration and MCP bindings", () => {
      const space = schema.getType("Space") as any;
      const mcpBinding = schema.getType("SpaceMcpServer") as any;
      const tenantMcpServer = schema.getType("SpaceTenantMcpServer") as any;

      expect(space?.toString()).toBe("Space");
      expect(space.getFields().icon.type.toString()).toBe("String");
      expect(space.getFields().category.type.toString()).toBe("String");
      expect(space.getFields().contextConfig.type.toString()).toBe("AWSJSON");
      expect(space.getFields().connectedDataConfig.type.toString()).toBe(
        "AWSJSON",
      );
      expect(space.getFields().toolPolicy.type.toString()).toBe("AWSJSON");
      expect(space.getFields().mcpPolicy.type.toString()).toBe("AWSJSON");
      expect(space.getFields().agentAvailabilityPolicy.type.toString()).toBe(
        "AWSJSON",
      );
      expect(space.getFields().triggerConfig.type.toString()).toBe("AWSJSON");
      expect(space.getFields().renderDiagnostics.type.toString()).toBe(
        "AWSJSON",
      );
      expect(space.getFields().mcpServers.type.toString()).toBe(
        "[SpaceMcpServer!]!",
      );
      expect(mcpBinding.getFields().mcpServer.type.toString()).toBe(
        "SpaceTenantMcpServer",
      );
      expect(tenantMcpServer.getFields().slug.type.toString()).toBe("String!");
    });
  });

  describe("Agents contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("allows Agents to own runtime and policy fields without requiring a Template", () => {
      const agent = schema.getType("Agent") as any;
      const createInput = schema.getType("CreateAgentInput") as any;
      const updateInput = schema.getType("UpdateAgentInput") as any;

      expect(agent.getFields().templateId).toBeUndefined();
      expect(agent.getFields().agentTemplate).toBeUndefined();
      expect(agent.getFields().model.type.toString()).toBe("String");
      expect(agent.getFields().guardrailId.type.toString()).toBe("ID");
      expect(agent.getFields().blockedTools.type.toString()).toBe("AWSJSON");
      expect(agent.getFields().sandbox.type.toString()).toBe("AWSJSON");
      expect(agent.getFields().browser.type.toString()).toBe("AWSJSON");
      expect(agent.getFields().webSearch.type.toString()).toBe("AWSJSON");
      expect(agent.getFields().sendEmail.type.toString()).toBe("AWSJSON");
      expect(agent.getFields().contextEngine.type.toString()).toBe("AWSJSON");
      expect(agent.getFields().budgetMonthlyCents.type.toString()).toBe("Int");

      expect(createInput.getFields().templateId).toBeUndefined();
      expect(createInput.getFields().model.type.toString()).toBe("String");
      expect(createInput.getFields().guardrailId.type.toString()).toBe("ID");
      expect(createInput.getFields().blockedTools.type.toString()).toBe(
        "AWSJSON",
      );

      expect(updateInput.getFields().templateId).toBeUndefined();
      expect(updateInput.getFields().runtime.type.toString()).toBe(
        "AgentRuntime",
      );
      expect(updateInput.getFields().budgetMonthlyCents.type.toString()).toBe(
        "Int",
      );
    });
  });

  describe("Computers and evals no longer expose Template wiring", () => {
    const schema = buildSchema(loadFullSchema());

    it("uses primaryAgentId for Computer creation instead of templateId", () => {
      const computer = schema.getType("Computer") as any;
      const createInput = schema.getType("CreateComputerInput") as any;
      const updateInput = schema.getType("UpdateComputerInput") as any;

      expect(computer.getFields().templateId).toBeUndefined();
      expect(createInput.getFields().templateId).toBeUndefined();
      expect(updateInput.getFields().templateId).toBeUndefined();
      expect(createInput.getFields().primaryAgentId.type.toString()).toBe("ID");
    });

    it("uses agentId for eval targets instead of agentTemplateId", () => {
      const evalRun = schema.getType("EvalRun") as any;
      const evalTestCase = schema.getType("EvalTestCase") as any;
      const startInput = schema.getType("StartEvalRunInput") as any;
      const createInput = schema.getType("CreateEvalTestCaseInput") as any;
      const updateInput = schema.getType("UpdateEvalTestCaseInput") as any;

      expect(evalRun.getFields().agentTemplateId).toBeUndefined();
      expect(evalTestCase.getFields().agentTemplateId).toBeUndefined();
      expect(startInput.getFields().agentTemplateId).toBeUndefined();
      expect(createInput.getFields().agentTemplateId).toBeUndefined();
      expect(updateInput.getFields().agentTemplateId).toBeUndefined();
      expect(evalTestCase.getFields().agentId.type.toString()).toBe("ID");
      expect(createInput.getFields().agentId.type.toString()).toBe("ID");
      expect(updateInput.getFields().agentId.type.toString()).toBe("ID");
    });
  });

  describe("Linked tasks contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("exposes mirrored task state and sync health without making ThinkWork the task system of record", () => {
      const linkedTask = schema.getType("LinkedTask");
      const event = schema.getType("LinkedTaskEvent");
      expect(linkedTask?.toString()).toBe("LinkedTask");
      expect(event?.toString()).toBe("LinkedTaskEvent");
      expect(
        (linkedTask as any).getFields().externalTaskId.type.toString(),
      ).toBe("String!");
      expect((linkedTask as any).getFields().syncStatus.type.toString()).toBe(
        "LinkedTaskSyncStatus!",
      );
      expect((linkedTask as any).getFields().events.type.toString()).toBe(
        "[LinkedTaskEvent!]!",
      );
    });
  });

  describe("v1 Mutation surface", () => {
    const schema = buildSchema(loadFullSchema());
    const mutationType = schema.getMutationType();
    const mutationFields = mutationType
      ? Object.keys(mutationType.getFields())
      : [];

    const expectedMutations = [
      // Agents
      "createAgent",
      "updateAgent",
      "deleteAgent",
      "setAgentCapabilities",
      "setAgentSkills",
      // Threads
      "createThread",
      "updateThread",
      "deleteThread",
      // Spaces
      "createSpace",
      "startCustomerOnboarding",
      // Messages
      "sendMessage",
      "deleteMessage",
      // Knowledge
      "createKnowledgeBase",
      "deleteKnowledgeBase",
      "syncKnowledgeBase",
      // Memory
      "deleteMemoryRecord",
      "updateMemoryRecord",
      // Ontology
      "startOntologySuggestionScan",
      "updateOntologyChangeSet",
      "approveOntologyChangeSet",
      "rejectOntologyChangeSet",
      "updateOntologyEntityType",
      "updateOntologyRelationshipType",
      // Inbox
      "createInboxItem",
      "approveInboxItem",
      "rejectInboxItem",
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
    const subFields = subscriptionType
      ? Object.keys(subscriptionType.getFields())
      : [];

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

    it("has business ontology types and change-set mutations", () => {
      expect(sdl).toContain("type OntologyEntityType");
      expect(sdl).toContain("type OntologyRelationshipType");
      expect(sdl).toContain("type OntologyChangeSet");
      expect(sdl).toContain("type OntologySuggestionScanJob");
      expect(sdl).toContain("ontologyDefinitions(");
      expect(sdl).toContain("startOntologySuggestionScan(");
      expect(sdl).toContain("approveOntologyChangeSet(");
      expect(sdl).toContain("updateOntologyEntityType(");
      expect(sdl).toContain("updateOntologyRelationshipType(");
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

    it("collaborative Thread contracts expose mention targets and participant read state", () => {
      const queryType = schema.getQueryType();
      const mentionTargets = queryType!.getFields().threadMentionTargets;
      expect(mentionTargets).toBeDefined();
      expect(String(mentionTargets.type)).toBe("[ThreadMentionTarget!]!");
      expect(mentionTargets.args.map((a) => a.name)).toEqual(["threadId"]);

      const mentionTarget = schema.getType("ThreadMentionTarget") as any;
      expect(mentionTarget).toBeDefined();
      expect(Object.keys(mentionTarget.getFields())).toEqual([
        "id",
        "targetType",
        "targetId",
        "displayName",
        "avatarUrl",
        "role",
      ]);

      const participant = schema.getType("ThreadParticipant") as any;
      expect(participant).toBeDefined();
      expect(String(participant.getFields().lastReadAt.type)).toBe(
        "AWSDateTime",
      );
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
      expect(
        mutationType?.getFields().publishComputerThreadChunk,
      ).toBeDefined();
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
