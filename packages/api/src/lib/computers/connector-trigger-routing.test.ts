import { describe, expect, it, vi } from "vitest";
import {
  hasConnectorTriggerDefinition,
  prepareConnectorTriggerDefinition,
  routeConnectorEventToComputer,
} from "./connector-trigger-routing.js";

describe("connector trigger routing", () => {
  it("normalizes a requester-owned connector trigger for an assigned Computer", async () => {
    const resolveConnection = vi.fn().mockResolvedValue({
      connectionId: "connection-1",
      providerId: "provider-1",
    });
    const hasComputerAccess = vi.fn().mockResolvedValue(true);

    const prepared = await prepareConnectorTriggerDefinition(
      {
        tenantId: "tenant-1",
        requesterUserId: "user-1",
        computerId: "computer-1",
        config: {
          provider: "google-gmail",
          eventType: "message.created",
          connectionId: "connection-1",
          filters: { label: "INBOX" },
        },
      },
      { resolveConnection, hasComputerAccess },
    );

    expect(resolveConnection).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      provider: "google-gmail",
      connectionId: "connection-1",
    });
    expect(hasComputerAccess).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      computerId: "computer-1",
      requesterUserId: "user-1",
    });
    expect(prepared).toEqual({
      triggerType: "event",
      scheduleType: "event",
      computerId: "computer-1",
      config: expect.objectContaining({
        provider: "google-gmail",
        connectorTrigger: {
          version: 1,
          provider: "google-gmail",
          eventType: "message.created",
          connectionId: "connection-1",
          computerId: "computer-1",
          requesterUserId: "user-1",
          credentialSubject: {
            type: "user",
            userId: "user-1",
            connectionId: "connection-1",
            provider: "google-gmail",
          },
          contextClass: "personal_connector_event",
          filters: { label: "INBOX" },
        },
      }),
    });
  });

  it("rejects connector trigger creation when the connection is not requester-owned", async () => {
    await expect(
      prepareConnectorTriggerDefinition(
        {
          tenantId: "tenant-1",
          requesterUserId: "user-1",
          computerId: "computer-1",
          config: {
            provider: "google-gmail",
            eventType: "message.created",
            connectionId: "connection-2",
          },
        },
        {
          resolveConnection: vi.fn().mockResolvedValue(null),
          hasComputerAccess: vi.fn().mockResolvedValue(true),
        },
      ),
    ).rejects.toThrow("active requester-owned connection");
  });

  it("rejects connector trigger creation when the requester lacks Computer access", async () => {
    await expect(
      prepareConnectorTriggerDefinition(
        {
          tenantId: "tenant-1",
          requesterUserId: "user-1",
          computerId: "computer-1",
          config: {
            provider: "google-calendar",
            eventType: "event.created",
            connectionId: "connection-1",
          },
        },
        {
          resolveConnection: vi.fn().mockResolvedValue({
            connectionId: "connection-1",
            providerId: "provider-1",
          }),
          hasComputerAccess: vi.fn().mockResolvedValue(false),
        },
      ),
    ).rejects.toThrow("not assigned to requester");
  });

  it("enqueues connector events with requester and credential-subject attribution", async () => {
    const enqueueTask = vi.fn().mockResolvedValue({ id: "task-1" });

    const result = await routeConnectorEventToComputer(
      {
        tenantId: "tenant-1",
        triggerId: "trigger-1",
        enabled: true,
        triggerType: "event",
        computerId: "computer-1",
        config: {
          connectorTrigger: {
            version: 1,
            provider: "google-gmail",
            eventType: "message.created",
            connectionId: "connection-1",
            computerId: "computer-1",
            requesterUserId: "user-1",
            credentialSubject: {
              type: "user",
              userId: "user-1",
              connectionId: "connection-1",
              provider: "google-gmail",
            },
            contextClass: "personal_connector_event",
          },
        },
        threadId: "thread-1",
        messageId: "message-1",
        eventId: "event-1",
        eventMetadata: { subject: "Hello" },
      },
      {
        resolveConnection: vi.fn().mockResolvedValue({
          connectionId: "connection-1",
          providerId: "provider-1",
        }),
        hasComputerAccess: vi.fn().mockResolvedValue(true),
        enqueueTask,
      },
    );

    expect(result.ok).toBe(true);
    expect(enqueueTask).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      computerId: "computer-1",
      taskType: "thread_turn",
      idempotencyKey: "connector-event:trigger-1:event-1",
      createdByUserId: "user-1",
      taskInput: expect.objectContaining({
        source: "personal_connector_event",
        actorType: "user",
        actorId: "user-1",
        requesterUserId: "user-1",
        contextClass: "personal_connector_event",
        credentialSubject: {
          type: "user",
          userId: "user-1",
          connectionId: "connection-1",
          provider: "google-gmail",
        },
        event: {
          provider: "google-gmail",
          eventType: "message.created",
          eventId: "event-1",
          metadata: { subject: "Hello" },
        },
      }),
    });
  });

  it("drops disabled connector event triggers without enqueueing", async () => {
    const enqueueTask = vi.fn();

    const result = await routeConnectorEventToComputer(
      {
        tenantId: "tenant-1",
        triggerId: "trigger-1",
        enabled: false,
        triggerType: "event",
        computerId: "computer-1",
        config: null,
        threadId: "thread-1",
        messageId: "message-1",
      },
      { enqueueTask },
    );

    expect(result).toEqual({ ok: false, reason: "trigger_disabled" });
    expect(enqueueTask).not.toHaveBeenCalled();
  });

  it("detects connector trigger definitions before requester normalization", () => {
    expect(
      hasConnectorTriggerDefinition({
        connectorTrigger: {
          provider: "google-gmail",
          connectionId: "connection-1",
        },
      }),
    ).toBe(true);
    expect(hasConnectorTriggerDefinition({ scheduleName: "daily" })).toBe(
      false,
    );
  });
});
