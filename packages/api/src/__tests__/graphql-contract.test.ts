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
import { coreMutations } from "../graphql/resolvers/core/index.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCHEMA_DIR = join(REPO_ROOT, "packages/database-pg/graphql");
const TYPES_DIR = join(SCHEMA_DIR, "types");
const TF_SCHEMA = join(REPO_ROOT, "terraform/schema.graphql");
const TF_APPSYNC_SUBSCRIPTIONS = join(
  REPO_ROOT,
  "terraform/modules/app/appsync-subscriptions/main.tf",
);

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
      "tenantAgent",
      "modelCatalog",
      "tenantModelCatalog",
      "bedrockModelImportCandidates",
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
      "costByUser",
      "costByModel",
      "accountUsage",
      "budgetPolicies",
      "budgetStatus",
      "userBudgetStatus",
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
      // Email Channel Plugin
      "emailChannelSummary",
      "emailSpaceEmailPolicy",
      "emailChannelLedger",
    ];

    for (const q of expectedQueries) {
      it(`has Query.${q}`, () => {
        expect(queryFields).toContain(q);
      });
    }
  });

  describe("Costs contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("exposes account usage profile contracts", () => {
      const query = schema.getQueryType() as any;
      const accountUsage = schema.getType("AccountUsage") as any;
      const summary = schema.getType("AccountUsageSummary") as any;
      const day = schema.getType("AccountUsageDay") as any;
      const model = schema.getType("AccountUsageModel") as any;

      expect(
        query
          .getFields()
          .accountUsage.args.map((arg: any) => [arg.name, arg.type.toString()]),
      ).toEqual([
        ["tenantId", "ID!"],
        ["userId", "ID!"],
        ["days", "Int"],
      ]);
      expect(query.getFields().accountUsage.type.toString()).toBe(
        "AccountUsage!",
      );
      expect(accountUsage.getFields().periodStart.type.toString()).toBe(
        "AWSDateTime!",
      );
      expect(accountUsage.getFields().periodEnd.type.toString()).toBe(
        "AWSDateTime!",
      );
      expect(accountUsage.getFields().summary.type.toString()).toBe(
        "AccountUsageSummary!",
      );
      expect(accountUsage.getFields().daily.type.toString()).toBe(
        "[AccountUsageDay!]!",
      );
      expect(accountUsage.getFields().models.type.toString()).toBe(
        "[AccountUsageModel!]!",
      );

      expect(summary.getFields().totalUsd.type.toString()).toBe("Float!");
      expect(day.getFields().inputTokens.type.toString()).toBe("Int!");
      expect(model.getFields().displayName.type.toString()).toBe("String!");
      expect(model.getFields().usageShare.type.toString()).toBe("Float!");
    });
  });

  describe("Spaces contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("exposes typed Space runtime overrides separately from the tenant agent baseline", () => {
      const space = schema.getType("Space");
      const runtimeOverrides = schema.getType("SpaceRuntimeOverrides") as any;
      expect(space?.toString()).toBe("Space");
      expect(
        space && (space as any).getFields().runtimeOverrides.type.toString(),
      ).toBe("SpaceRuntimeOverrides!");
      expect(runtimeOverrides.getFields().model.type.toString()).toBe("String");
      expect(runtimeOverrides.getFields().guardrailId.type.toString()).toBe(
        "ID",
      );
      expect(
        runtimeOverrides.getFields().budgetMonthlyCents.type.toString(),
      ).toBe("Int");
      expect(runtimeOverrides.getFields().budgetPaused.type.toString()).toBe(
        "Boolean",
      );
      expect(runtimeOverrides.getFields().sandbox.type.toString()).toBe(
        "Boolean",
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
      expect(space.getFields().emailTriggerStatus.type.toString()).toBe(
        "SpaceEmailTriggerStatus!",
      );
      expect(space.getFields().emailTriggersEnabled.type.toString()).toBe(
        "Boolean!",
      );
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

    it("exposes the per-Space email trigger mutation", () => {
      const mutation = schema.getMutationType() as any;
      const statusEnum = schema.getType("SpaceEmailTriggerStatus") as any;
      const updateInput = schema.getType("UpdateSpaceEmailTriggerInput") as any;

      expect(statusEnum.getValues().map((value: any) => value.name)).toEqual([
        "NONE",
        "DISABLED",
        "ENABLED",
      ]);
      expect(updateInput.getFields().spaceId.type.toString()).toBe("ID!");
      expect(updateInput.getFields().status.type.toString()).toBe(
        "SpaceEmailTriggerStatus!",
      );
      expect(updateInput.getFields().emailPrefix.type.toString()).toBe(
        "String",
      );

      expect(mutation.getFields().setSpaceEmailTriggers.type.toString()).toBe(
        "Space!",
      );
      expect(
        mutation
          .getFields()
          .updateSpaceEmailTrigger.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([["input", "UpdateSpaceEmailTriggerInput!"]]);

      expect(mutation.getFields().updateSpaceEmailTrigger.type.toString()).toBe(
        "Space!",
      );
      expect(
        mutation
          .getFields()
          .setSpaceEmailTriggers.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["spaceId", "ID!"],
        ["enabled", "Boolean!"],
      ]);
    });

    it("exposes addSpaceMember and removeSpaceMember mutations", () => {
      const mutation = schema.getMutationType() as any;

      expect(mutation.getFields().addSpaceMember.type.toString()).toBe(
        "SpaceMember!",
      );
      expect(
        mutation
          .getFields()
          .addSpaceMember.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["spaceId", "ID!"],
        ["userId", "ID!"],
      ]);

      expect(mutation.getFields().removeSpaceMember.type.toString()).toBe(
        "Boolean!",
      );
      expect(
        mutation
          .getFields()
          .removeSpaceMember.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["spaceId", "ID!"],
        ["userId", "ID!"],
      ]);
    });
  });

  describe("Email Channel Plugin contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("exposes provider readiness and Space policy surfaces", () => {
      const query = schema.getQueryType() as any;
      const mutation = schema.getMutationType() as any;
      const providerEnum = schema.getType("EmailChannelProvider") as any;
      const readinessEnum = schema.getType("EmailReadinessCheckKey") as any;

      expect(providerEnum.getValues().map((value: any) => value.name)).toEqual([
        "RESEND",
        "SENDGRID",
        "SES",
      ]);
      expect(readinessEnum.getValues().map((value: any) => value.name)).toEqual(
        [
          "CREDENTIALS",
          "SENDING_DOMAIN",
          "INBOUND_RECEIVING",
          "WEBHOOK_SIGNATURE",
          "PROVIDER_EVENTS",
          "LOOP_TEST",
        ],
      );

      expect(query.getFields().emailChannelSummary.type.toString()).toBe(
        "EmailChannelSummary!",
      );
      expect(
        query
          .getFields()
          .emailSpaceEmailPolicy.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([["spaceId", "ID!"]]);
      expect(query.getFields().emailChannelLedger.type.toString()).toBe(
        "[EmailLedgerEvent!]!",
      );

      expect(mutation.getFields().configureEmailProvider.type.toString()).toBe(
        "EmailProviderInstall!",
      );
      expect(
        mutation.getFields().updateEmailReadinessCheck.type.toString(),
      ).toBe("EmailReadinessCheck!");
      expect(mutation.getFields().upsertEmailSpacePolicy.type.toString()).toBe(
        "EmailSpacePolicy!",
      );
    });

    it("does not expose provider secrets or raw retained email bodies", () => {
      const provider = schema.getType("EmailProviderInstall") as any;
      const providerFields = provider.getFields();
      expect(providerFields.credentialConfigured.type.toString()).toBe(
        "Boolean!",
      );
      expect(providerFields.webhookSecretConfigured.type.toString()).toBe(
        "Boolean!",
      );
      expect(providerFields.credentialSecretRef).toBeUndefined();
      expect(providerFields.webhookSecretRef).toBeUndefined();

      const bodyRef = schema.getType("EmailBodyObjectRef") as any;
      const bodyFields = bodyRef.getFields();
      expect(bodyFields.contentHash.type.toString()).toBe("String!");
      expect(bodyFields.retentionUntil.type.toString()).toBe("AWSDateTime!");
      expect(bodyFields.redactedAt.type.toString()).toBe("AWSDateTime");
      expect(bodyFields.objectRef).toBeUndefined();
      expect(bodyFields.rawBody).toBeUndefined();
      expect(bodyFields.body).toBeUndefined();

      const ledger = schema.getType("EmailLedgerEvent") as any;
      expect(ledger.getFields().bodyObject.type.toString()).toBe(
        "EmailBodyObjectRef",
      );
    });
  });

  describe("Agents contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("allows Agents to own runtime and policy fields without requiring a Template", () => {
      const agent = schema.getType("Agent") as any;
      const updateInput = schema.getType("UpdateTenantAgentInput") as any;

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

      expect(updateInput.getFields().templateId).toBeUndefined();
      expect(updateInput.getFields().runtime.type.toString()).toBe(
        "AgentRuntime",
      );
      expect(updateInput.getFields().model.type.toString()).toBe("String");
      expect(updateInput.getFields().guardrailId.type.toString()).toBe("ID");
      expect(updateInput.getFields().blockedTools.type.toString()).toBe(
        "AWSJSON",
      );
      expect(updateInput.getFields().budgetMonthlyCents.type.toString()).toBe(
        "Int",
      );
    });

    it("exposes tenant goal budget settings", () => {
      const tenantSettings = schema.getType("TenantSettings") as any;
      const updateInput = schema.getType("UpdateTenantSettingsInput") as any;

      expect(
        tenantSettings.getFields().goalDefaultTokenBudget.type.toString(),
      ).toBe("Int");
      expect(
        updateInput.getFields().goalDefaultTokenBudget.type.toString(),
      ).toBe("Int");
    });

    it("exposes tenant model catalog management contracts", () => {
      const query = schema.getQueryType() as any;
      const mutation = schema.getMutationType() as any;
      const tenantEntry = schema.getType("TenantModelCatalogEntry") as any;
      const candidate = schema.getType("BedrockModelImportCandidate") as any;
      const importInput = schema.getType(
        "ImportTenantBedrockModelsInput",
      ) as any;
      const updateInput = schema.getType(
        "UpdateTenantModelCatalogEntryInput",
      ) as any;

      expect(
        query
          .getFields()
          .tenantModelCatalog.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["tenantId", "ID!"],
        ["includeDisabled", "Boolean"],
      ]);
      expect(query.getFields().tenantModelCatalog.type.toString()).toBe(
        "[TenantModelCatalogEntry!]!",
      );
      expect(
        query.getFields().bedrockModelImportCandidates.type.toString(),
      ).toBe("[BedrockModelImportCandidate!]!");

      expect(tenantEntry.getFields().displayName.type.toString()).toBe(
        "String!",
      );
      expect(tenantEntry.getFields().enabled.type.toString()).toBe("Boolean!");
      expect(tenantEntry.getFields().pricingStatus.type.toString()).toBe(
        "String!",
      );
      expect(candidate.getFields().provider.type.toString()).toBe("String!");
      expect(candidate.getFields().pricingDiagnostics.type.toString()).toBe(
        "AWSJSON!",
      );
      expect(candidate.getFields().alreadyImported.type.toString()).toBe(
        "Boolean!",
      );

      expect(importInput.getFields().tenantId.type.toString()).toBe("ID!");
      expect(importInput.getFields().models.type.toString()).toBe(
        "[ImportTenantBedrockModelInput!]!",
      );
      expect(updateInput.getFields().displayName.type.toString()).toBe(
        "String",
      );
      expect(updateInput.getFields().enabled.type.toString()).toBe("Boolean");
      expect(
        mutation.getFields().importTenantBedrockModels.type.toString(),
      ).toBe("[TenantModelCatalogEntry!]!");
      expect(
        mutation.getFields().updateTenantModelCatalogEntry.type.toString(),
      ).toBe("TenantModelCatalogEntry!");
    });
  });

  describe("Computers and evals no longer expose Template wiring", () => {
    const schema = buildSchema(loadFullSchema());

    it("Computer types are fully retired", () => {
      expect(schema.getType("Computer")).toBeUndefined();
      expect(schema.getType("CreateComputerInput")).toBeUndefined();
      expect(schema.getType("UpdateComputerInput")).toBeUndefined();
    });

    it("resolves eval targets through the tenant platform agent, not a per-input agentId", () => {
      const evalRun = schema.getType("EvalRun") as any;
      const evalTestCase = schema.getType("EvalTestCase") as any;
      const startInput = schema.getType("StartEvalRunInput") as any;
      const createInput = schema.getType("CreateEvalTestCaseInput") as any;
      const updateInput = schema.getType("UpdateEvalTestCaseInput") as any;

      // Legacy agentTemplateId never returns.
      expect(evalRun.getFields().agentTemplateId).toBeUndefined();
      expect(evalTestCase.getFields().agentTemplateId).toBeUndefined();
      expect(startInput.getFields().agentTemplateId).toBeUndefined();
      expect(createInput.getFields().agentTemplateId).toBeUndefined();
      expect(updateInput.getFields().agentTemplateId).toBeUndefined();

      // Per-input agentId retired by the one-platform-agent refactor.
      expect(evalTestCase.getFields().agentId).toBeUndefined();
      expect(startInput.getFields().agentId).toBeUndefined();
      expect(createInput.getFields().agentId).toBeUndefined();
      expect(updateInput.getFields().agentId).toBeUndefined();

      // EvalRun.agentId persists as the resolved platform-agent FK for display.
      expect(evalRun.getFields().agentId.type.toString()).toBe("ID");
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
      // Tenant agent
      "updateTenantAgent",
      "importTenantBedrockModels",
      "updateTenantModelCatalogEntry",
      // Core
      "renameTenantSlug",
      "setTenantMemberPassword",
      // Threads
      "createThread",
      "updateThread",
      "deleteThread",
      // Spaces
      "createSpace",
      "setSpaceRuntimeOverrides",
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
      // Costs
      "upsertBudgetPolicy",
      "deleteBudgetPolicy",
      "unpauseAgent",
      "unpauseUserBudget",
      // Email Channel Plugin
      "configureEmailProvider",
      "updateEmailReadinessCheck",
      "upsertEmailSpacePolicy",
      "addEmailSpaceSenderAllowlist",
      "removeEmailSpaceSenderAllowlist",
    ];

    for (const m of expectedMutations) {
      it(`has Mutation.${m}`, () => {
        expect(mutationFields).toContain(m);
      });
    }

    it("exposes the dedicated member invite resend contract", () => {
      const mutation = schema.getMutationType() as any;
      const input = schema.getType("ResendMemberInviteInput") as any;
      const result = schema.getType("ResendMemberInviteResult") as any;
      const status = schema.getType("ResendMemberInviteStatus") as any;

      expect(mutation.getFields().resendMemberInvite.type.toString()).toBe(
        "ResendMemberInviteResult!",
      );
      expect(
        mutation
          .getFields()
          .resendMemberInvite.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["tenantId", "ID!"],
        ["input", "ResendMemberInviteInput!"],
      ]);
      expect(input.getFields().memberId.type.toString()).toBe("ID!");
      expect(input.getFields().idempotencyKey.type.toString()).toBe("String!");
      expect(result.getFields().status.type.toString()).toBe(
        "ResendMemberInviteStatus!",
      );
      expect(result.getFields().message.type.toString()).toBe("String!");
      expect(result.getFields().member).toBeUndefined();
      expect(status.getValues().map((value: any) => value.name)).toEqual([
        "RESENT",
        "NOT_PENDING",
        "DELIVERY_FAILED",
      ]);
      expect(coreMutations.resendMemberInvite).toEqual(expect.any(Function));
    });

    it("exposes manual user setup separately from email invite delivery", () => {
      const mutation = schema.getMutationType() as any;
      const input = schema.getType("AddManualUserInput") as any;

      expect(mutation.getFields().addManualUser.type.toString()).toBe(
        "TenantMember!",
      );
      expect(
        mutation
          .getFields()
          .addManualUser.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["tenantId", "ID!"],
        ["input", "AddManualUserInput!"],
      ]);
      expect(input.getFields().email.type.toString()).toBe("String!");
      expect(input.getFields().name.type.toString()).toBe("String");
      expect(input.getFields().role.type.toString()).toBe("String");
      expect(input.getFields().idempotencyKey.type.toString()).toBe("String!");
      expect(coreMutations.addManualUser).toEqual(expect.any(Function));
    });

    it("exposes operator password setup separately from invite delivery", () => {
      const mutation = schema.getMutationType() as any;
      const input = schema.getType("SetTenantMemberPasswordInput") as any;
      const result = schema.getType("SetTenantMemberPasswordResult") as any;

      expect(mutation.getFields().setTenantMemberPassword.type.toString()).toBe(
        "SetTenantMemberPasswordResult!",
      );
      expect(
        mutation
          .getFields()
          .setTenantMemberPassword.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([
        ["tenantId", "ID!"],
        ["input", "SetTenantMemberPasswordInput!"],
      ]);
      expect(input.getFields().memberId.type.toString()).toBe("ID!");
      expect(input.getFields().password.type.toString()).toBe("String!");
      expect(input.getFields().permanent.type.toString()).toBe("Boolean");
      expect(result.getFields().status.type.toString()).toBe("String!");
      expect(result.getFields().message.type.toString()).toBe("String!");
      expect(coreMutations.setTenantMemberPassword).toEqual(
        expect.any(Function),
      );
    });
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
      "onWorkspaceAccessRevoked",
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

    it("turn-start inputs accept an optional selected parent model", () => {
      const createThreadInput = schema.getType("CreateThreadInput");
      const sendMessageInput = schema.getType("SendMessageInput");
      expect(createThreadInput).toBeDefined();
      expect(sendMessageInput).toBeDefined();
      expect(String((createThreadInput as any).getFields().modelId.type)).toBe(
        "String",
      );
      expect(String((sendMessageInput as any).getFields().modelId.type)).toBe(
        "String",
      );
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
        "aliases",
        "isDefaultAgent",
        "avatarUrl",
        "role",
        "email",
        "description",
      ]);

      const participant = schema.getType("ThreadParticipant") as any;
      expect(participant).toBeDefined();
      expect(String(participant.getFields().lastReadAt.type)).toBe(
        "AWSDateTime",
      );
    });
  });

  describe("Managed applications contract", () => {
    const schema = buildSchema(loadFullSchema());

    it("exposes managed application deployment status and health checks", () => {
      const query = schema.getQueryType() as any;
      const deploymentStatus = schema.getType("DeploymentStatus") as any;
      const managedApp = schema.getType("ManagedApplicationDeployment") as any;
      const health = schema.getType("ManagedApplicationHealthCheck") as any;

      expect(query.getFields().deploymentStatus.type.toString()).toBe(
        "DeploymentStatus!",
      );
      expect(
        query.getFields().managedApplicationHealthCheck.type.toString(),
      ).toBe("ManagedApplicationHealthCheck!");
      expect(
        query
          .getFields()
          .managedApplicationHealthCheck.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([["key", "String!"]]);

      expect(
        deploymentStatus.getFields().managedApplications.type.toString(),
      ).toBe("[ManagedApplicationDeployment!]!");
      expect(
        deploymentStatus.getFields().twentyProvisioned.type.toString(),
      ).toBe("Boolean!");
      expect(
        deploymentStatus.getFields().twentyRuntimeEnabled.type.toString(),
      ).toBe("Boolean!");
      expect(managedApp.getFields().key.type.toString()).toBe("String!");
      expect(managedApp.getFields().status.type.toString()).toBe("String!");
      expect(managedApp.getFields().runtimeEnabled.type.toString()).toBe(
        "Boolean!",
      );
      expect(managedApp.getFields().storageBucketName.type.toString()).toBe(
        "String",
      );
      expect(managedApp.getFields().databaseName.type.toString()).toBe(
        "String",
      );
      expect(managedApp.getFields().managedMcpServerId.type.toString()).toBe(
        "ID",
      );
      expect(managedApp.getFields().managedMcpStatus.type.toString()).toBe(
        "String!",
      );
      expect(managedApp.getFields().managedMcpInstalled.type.toString()).toBe(
        "Boolean!",
      );
      expect(
        managedApp.getFields().managedMcpInstallAvailable.type.toString(),
      ).toBe("Boolean!");
      expect(health.getFields().key.type.toString()).toBe("String!");
    });

    it("exposes platform-operator managed application deploy mutation", () => {
      const mutation = schema.getMutationType() as any;
      const input = schema.getType(
        "SetManagedApplicationDeploymentInput",
      ) as any;
      const change = schema.getType(
        "ManagedApplicationDeploymentChange",
      ) as any;

      expect(
        mutation.getFields().setManagedApplicationDeployment.type.toString(),
      ).toBe("ManagedApplicationDeploymentChange!");
      expect(
        mutation
          .getFields()
          .setManagedApplicationDeployment.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([["input", "SetManagedApplicationDeploymentInput!"]]);
      expect(schema.getType("ManagedApplicationDeploymentAction")).toBeTruthy();
      expect(input.getFields().key.type.toString()).toBe("String!");
      expect(input.getFields().enabled.type.toString()).toBe("Boolean");
      expect(input.getFields().action.type.toString()).toBe(
        "ManagedApplicationDeploymentAction",
      );
      expect(change.getFields().action.type.toString()).toBe("String!");
      expect(change.getFields().provisioned.type.toString()).toBe("Boolean!");
      expect(change.getFields().runtimeEnabled.type.toString()).toBe(
        "Boolean!",
      );
    });

    it("exposes platform-operator managed MCP install mutation", () => {
      const mutation = schema.getMutationType() as any;
      const registration = schema.getType(
        "ManagedApplicationMcpRegistration",
      ) as any;

      expect(
        mutation.getFields().installManagedApplicationMcpServer.type.toString(),
      ).toBe("ManagedApplicationMcpRegistration!");
      expect(
        mutation
          .getFields()
          .installManagedApplicationMcpServer.args.map((arg: any) => [
            arg.name,
            arg.type.toString(),
          ]),
      ).toEqual([["key", "String!"]]);
      expect(registration.getFields().serverId.type.toString()).toBe("ID");
      expect(registration.getFields().installed.type.toString()).toBe(
        "Boolean!",
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
      expect(fields).toContain("notifyThreadTurnStep");
      expect(fields).toContain("notifyWorkspaceAccessRevoked");
    });

    it("exposes the threadId-scoped onThreadTurnStep subscription", () => {
      const subscriptionType = tfSchema.getSubscriptionType();
      const field = subscriptionType?.getFields().onThreadTurnStep;
      expect(field).toBeDefined();
      // Live step feed is threadId-scoped (like onNewMessage), not tenant-wide.
      expect(field?.args.map((a) => a.name)).toEqual(["threadId"]);
    });

    it("does not allow API-key revocation subscriptions", () => {
      const sdl = readFileSync(TF_SCHEMA, "utf-8");
      const block = sdl.match(
        /onWorkspaceAccessRevoked\(userId: ID!\): WorkspaceAccessRevokedEvent[\s\S]*?@aws_subscribe\(mutations: \["notifyWorkspaceAccessRevoked"\]\)/,
      );
      expect(block?.[0]).toContain("@aws_cognito_user_pools");
      expect(block?.[0]).toContain("@aws_iam");
      expect(block?.[0]).not.toContain("@aws_api_key");
    });

    it("wires notification mutations to AppSync resolvers", () => {
      const terraform = readFileSync(TF_APPSYNC_SUBSCRIPTIONS, "utf-8");
      expect(terraform).toContain('"notifyWorkspaceAccessRevoked"');
    });

    // Regression guard: a subscription bound via @aws_subscribe to a notify
    // mutation that has NO AppSync resolver fans out nothing — the server's
    // publish lands on a missing resolver and the client silently receives no
    // events. (This is exactly how onThreadTurnStep shipped broken: schema +
    // helper present, terraform resolver list missing the entry.) Every
    // @aws_subscribe mutation MUST appear in the terraform notification list.
    it("every @aws_subscribe mutation has a terraform AppSync resolver", () => {
      const sdl = readFileSync(TF_SCHEMA, "utf-8");
      const terraform = readFileSync(TF_APPSYNC_SUBSCRIPTIONS, "utf-8");
      const boundMutations = new Set<string>();
      for (const match of sdl.matchAll(
        /@aws_subscribe\(mutations:\s*\[([^\]]*)\]\)/g,
      )) {
        for (const raw of match[1].split(",")) {
          const name = raw.trim().replace(/^["']|["']$/g, "");
          if (name) boundMutations.add(name);
        }
      }
      expect(boundMutations.size).toBeGreaterThan(0);
      const missing = [...boundMutations].filter(
        (m) => !terraform.includes(`"${m}"`),
      );
      expect(missing).toEqual([]);
    });

    it("Computer thread chunk subscription is retired", () => {
      const mutationType = tfSchema.getMutationType();
      const subscriptionType = tfSchema.getSubscriptionType();
      expect(tfSchema.getType("ComputerThreadChunkEvent")).toBeUndefined();
      expect(
        mutationType?.getFields().publishComputerThreadChunk,
      ).toBeUndefined();
      expect(
        subscriptionType?.getFields().onComputerThreadChunk,
      ).toBeUndefined();
    });

    it("does NOT have product Query fields", () => {
      const queryType = tfSchema.getQueryType();
      const fields = queryType ? Object.keys(queryType.getFields()) : [];
      // Should only have _empty placeholder
      expect(fields).toEqual(["_empty"]);
    });
  });
});
