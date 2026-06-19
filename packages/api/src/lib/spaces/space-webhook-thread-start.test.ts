import { describe, expect, it, vi } from "vitest";

import {
  buildWebhookOpeningSummary,
  startSpaceWebhookThread,
} from "./space-webhook-thread-start.js";

describe("buildWebhookOpeningSummary", () => {
  it("summarizes Twenty-style Customer-stage payloads without dumping raw JSON", () => {
    const summary = buildWebhookOpeningSummary({
      webhookName: "Twenty Customer Stage",
      payload: {
        event: "opportunity.stage.customer",
        stage: "CUSTOMER",
        companyName: "McPherson Oil",
        opportunityName: "McPherson POC",
        opportunityUrl: "https://crm.thinkwork.ai/objects/opportunities/opp-1",
      },
    });

    expect(summary).toContain('Webhook "Twenty Customer Stage" was triggered.');
    expect(summary).toContain("Event: opportunity.stage.customer");
    expect(summary).toContain("Customer: McPherson Oil");
    expect(summary).toContain("Opportunity: McPherson POC");
    expect(summary).toContain("Stage: CUSTOMER");
    expect(summary).not.toContain("{");
    expect(summary).not.toContain("opportunityUrl");
  });

  it("keeps empty payloads readable", () => {
    expect(
      buildWebhookOpeningSummary({
        webhookName: "Inventory Alert",
        payload: {},
      }),
    ).toBe('Webhook "Inventory Alert" was triggered.');
  });

  it("bounds very long payload fields in the transcript summary", () => {
    const summary = buildWebhookOpeningSummary({
      webhookName: "Long Payload",
      payload: {
        event: "x".repeat(1000),
        companyName: "Acme".repeat(1000),
      },
    });

    expect(summary.length).toBeLessThanOrEqual(1200);
    expect(summary).toContain("...");
  });
});

describe("startSpaceWebhookThread", () => {
  it("creates a webhook thread and inserts an opening system trigger message", async () => {
    const ensureThreadForWork = vi.fn(async () => ({
      threadId: "thread-1",
      identifier: "HOOK-42",
      number: 42,
    }));
    const insertOpeningMessage = vi.fn(async () => ({ id: "message-1" }));
    const now = new Date("2026-06-19T12:00:00.000Z");

    const result = await startSpaceWebhookThread(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        webhookId: "webhook-1",
        webhookName: "Twenty Customer Stage",
        payload: {
          event: "opportunity.stage.customer",
          companyName: "McPherson Oil",
          opportunityName: "McPherson POC",
          stage: "CUSTOMER",
        },
      },
      {
        ensureThreadForWork,
        insertOpeningMessage,
        findSpace: vi.fn(async () => null),
        now: () => now,
      },
    );

    expect(ensureThreadForWork).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      spaceId: "space-1",
      title: "Twenty Customer Stage",
      channel: "webhook",
    });
    expect(insertOpeningMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        content: expect.stringContaining("McPherson Oil"),
        createdAt: now,
        metadata: expect.objectContaining({
          source: "webhook",
          webhookId: "webhook-1",
          webhookName: "Twenty Customer Stage",
        }),
      }),
    );
    expect(result).toMatchObject({
      threadId: "thread-1",
      identifier: "HOOK-42",
      number: 42,
      openingMessageId: "message-1",
      openingMessageAlreadyPersisted: true,
      warnings: [],
      workflow: null,
      openingMessageContent: expect.stringContaining(
        'Webhook "Twenty Customer Stage" was triggered.',
      ),
      agentContext: {
        webhookPayload: {
          event: "opportunity.stage.customer",
          companyName: "McPherson Oil",
          opportunityName: "McPherson POC",
          stage: "CUSTOMER",
        },
        webhookId: "webhook-1",
        webhookName: "Twenty Customer Stage",
        spaceId: "space-1",
      },
    });
  });

  it("initializes Customer Onboarding on the already-created webhook thread", async () => {
    const ensureThreadForWork = vi.fn(async () => ({
      threadId: "thread-1",
      identifier: "HOOK-42",
      number: 42,
    }));
    const startCustomerOnboardingWorkflow = vi.fn(async () => ({
      thread: {
        id: "thread-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        title: "McPherson Oil onboarding",
        identifier: "HOOK-42",
        metadata: {
          customerOnboarding: {
            workflow: "customer_onboarding",
          },
        },
      },
      idempotent: false,
      linkedTasks: [
        {
          checklistItemId: "item-1",
          provider: "thinkwork" as const,
          title: "Send DocuSign package",
          externalTaskId: "thinkwork:thread-1:docusign_package",
          externalTaskUrl: null,
          status: "todo" as const,
          blocked: false,
          syncStatus: "synced" as const,
        },
      ],
      missingFields: ["primaryContact"],
    }));

    const result = await startSpaceWebhookThread(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        webhookId: "webhook-1",
        webhookName: "Twenty Customer Stage",
        payload: {
          event: "opportunity.stage.customer",
          opportunityId: "opp-1",
          companyName: "McPherson Oil",
        },
      },
      {
        ensureThreadForWork,
        insertOpeningMessage: vi.fn(async () => ({ id: "message-1" })),
        findSpace: vi.fn(async () => ({
          id: "space-1",
          tenantId: "tenant-1",
          kind: "custom",
          templateKey: null,
          config: { workflow: "customer_onboarding" },
        })),
        startCustomerOnboardingWorkflow,
      },
    );

    expect(startCustomerOnboardingWorkflow).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      spaceId: "space-1",
      source: "webhook",
      opportunity: {
        event: "opportunity.stage.customer",
        opportunityId: "opp-1",
        companyName: "McPherson Oil",
      },
      preparedThread: {
        id: "thread-1",
        tenantId: "tenant-1",
        spaceId: "space-1",
        title: "Twenty Customer Stage",
        identifier: "HOOK-42",
        metadata: null,
      },
      startedBy: { type: "system" },
    });
    expect(result.workflow).toEqual({
      key: "customer_onboarding",
      threadId: "thread-1",
      idempotent: false,
      missingFields: ["primaryContact"],
      linkedTaskCount: 1,
    });
    expect(result.warnings).toEqual([]);
  });

  it("does not call Customer Onboarding for generic Spaces without workflows", async () => {
    const startCustomerOnboardingWorkflow = vi.fn();

    await startSpaceWebhookThread(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        webhookId: "webhook-1",
        webhookName: "Generic Webhook",
        payload: {},
      },
      {
        ensureThreadForWork: vi.fn(async () => ({
          threadId: "thread-1",
          identifier: "HOOK-1",
          number: 1,
        })),
        insertOpeningMessage: vi.fn(async () => ({ id: "message-1" })),
        findSpace: vi.fn(async () => ({
          id: "space-1",
          tenantId: "tenant-1",
          kind: "custom",
          templateKey: null,
          config: { workflow: "general" },
        })),
        startCustomerOnboardingWorkflow,
      },
    );

    expect(startCustomerOnboardingWorkflow).not.toHaveBeenCalled();
  });

  it("returns workflow warnings when onboarding initialization fails after thread creation", async () => {
    const insertWorkflowWarningMessage = vi.fn(async () => ({
      id: "warning-message-1",
    }));

    const result = await startSpaceWebhookThread(
      {
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        webhookId: "webhook-1",
        webhookName: "Twenty Customer Stage",
        payload: { opportunityId: "opp-no-customer" },
      },
      {
        ensureThreadForWork: vi.fn(async () => ({
          threadId: "thread-1",
          identifier: "HOOK-1",
          number: 1,
        })),
        insertOpeningMessage: vi.fn(async () => ({ id: "message-1" })),
        findSpace: vi.fn(async () => ({
          id: "space-1",
          tenantId: "tenant-1",
          kind: "customer_onboarding",
          templateKey: null,
          config: {},
        })),
        startCustomerOnboardingWorkflow: vi.fn(async () => {
          throw new Error("customerId or customerName is required");
        }),
        insertWorkflowWarningMessage,
      },
    );

    expect(result.workflow).toBeNull();
    expect(result.warnings).toEqual([
      {
        code: "CUSTOMER_ONBOARDING_WORKFLOW_FAILED",
        message:
          "Customer Onboarding workflow could not be initialized for this webhook-created thread. customerId or customerName is required",
        workflowKey: "customer_onboarding",
      },
    ]);
    expect(result.agentContext.workflowWarnings).toEqual(result.warnings);
    expect(insertWorkflowWarningMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        threadId: "thread-1",
        content: result.warnings[0]?.message,
        metadata: expect.objectContaining({
          kind: "workflow_warning",
          workflowKey: "customer_onboarding",
        }),
      }),
    );
  });

  it("does not insert a message when thread creation fails", async () => {
    const ensureThreadForWork = vi.fn(async () => {
      throw new Error("Tenant not found");
    });
    const insertOpeningMessage = vi.fn();

    await expect(
      startSpaceWebhookThread(
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          webhookId: "webhook-1",
          webhookName: "Broken Webhook",
          payload: {},
        },
        { ensureThreadForWork, insertOpeningMessage },
      ),
    ).rejects.toThrow("Tenant not found");

    expect(insertOpeningMessage).not.toHaveBeenCalled();
  });

  it("surfaces message insertion failure as a hard pre-wakeup error", async () => {
    await expect(
      startSpaceWebhookThread(
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          webhookId: "webhook-1",
          webhookName: "Broken Message",
          payload: {},
        },
        {
          ensureThreadForWork: vi.fn(async () => ({
            threadId: "thread-1",
            identifier: "HOOK-1",
            number: 1,
          })),
          insertOpeningMessage: vi.fn(async () => {
            throw new Error("insert failed");
          }),
        },
      ),
    ).rejects.toThrow("insert failed");
  });
});
