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
