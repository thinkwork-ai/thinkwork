import { describe, expect, it, vi } from "vitest";
import {
  assembleRequesterContext,
  RequesterContextError,
} from "./requester-context.js";
import type { RecallResult } from "../memory/index.js";

function memory(overrides: Partial<RecallResult> = {}): RecallResult {
  return {
    record: {
      id: "memory-eric-1",
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "user-eric",
      kind: "unit",
      sourceType: "thread_turn",
      status: "active",
      content: {
        summary: "Eric prefers concise launch briefs",
        text: "Eric prefers concise launch briefs with risks called out first.",
      },
      backendRefs: [{ backend: "hindsight", ref: "user_eric" }],
      createdAt: "2026-05-17T12:00:00.000Z",
      metadata: {},
    },
    score: 0.93,
    backend: "hindsight",
    whyRecalled: "preference match",
    ...overrides,
  };
}

describe("assembleRequesterContext", () => {
  it("retrieves requester-scoped memory with provenance", async () => {
    const recall = {
      recall: vi.fn().mockResolvedValue([memory()]),
    };

    const result = await assembleRequesterContext(
      {
        tenantId: "tenant-1",
        computerId: "computer-sales",
        requesterUserId: "user-eric",
        prompt: "Draft the launch brief",
        sourceSurface: "slack",
      },
      {
        recall,
        validateRequester: async () => true,
      },
    );

    expect(recall.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-eric",
        query: "Draft the launch brief",
        requestContext: expect.objectContaining({
          computerId: "computer-sales",
          requesterUserId: "user-eric",
          sourceSurface: "slack",
        }),
      }),
    );
    expect(result.personalMemory.status).toMatchObject({
      state: "ok",
      hitCount: 1,
      metadata: {
        contextClass: "user",
        requesterUserId: "user-eric",
        computerId: "computer-sales",
      },
    });
    expect(result.personalMemory.hits[0]).toMatchObject({
      id: "memory-eric-1",
      title: "Eric prefers concise launch briefs",
      provenance: {
        backend: "hindsight",
        ownerType: "user",
        ownerId: "user-eric",
      },
    });
  });

  it("returns an explicit skipped status when no personal memory matches", async () => {
    const result = await assembleRequesterContext(
      {
        tenantId: "tenant-1",
        computerId: "computer-finance",
        requesterUserId: "user-eric",
        prompt: "Anything relevant?",
      },
      {
        recall: { recall: vi.fn().mockResolvedValue([]) },
        validateRequester: async () => true,
      },
    );

    expect(result.personalMemory.hits).toEqual([]);
    expect(result.personalMemory.status).toMatchObject({
      state: "skipped",
      reason: "no personal memory matched the request",
    });
  });

  it("returns an explicit error status when memory recall fails", async () => {
    const result = await assembleRequesterContext(
      {
        tenantId: "tenant-1",
        computerId: "computer-finance",
        requesterUserId: "user-eric",
        prompt: "Anything relevant?",
      },
      {
        recall: {
          recall: vi.fn().mockRejectedValue(new Error("hindsight unavailable")),
        },
        validateRequester: async () => true,
      },
    );

    expect(result.personalMemory.hits).toEqual([]);
    expect(result.personalMemory.status).toMatchObject({
      state: "error",
      reason: "hindsight unavailable",
      metadata: {
        requesterUserId: "user-eric",
        computerId: "computer-finance",
      },
    });
  });

  it("fails closed when a user-scoped request lacks a requester id", async () => {
    await expect(
      assembleRequesterContext(
        {
          tenantId: "tenant-1",
          computerId: "computer-sales",
          prompt: "Draft the launch brief",
          contextClass: "user",
        },
        { recall: { recall: vi.fn() }, validateRequester: async () => true },
      ),
    ).rejects.toMatchObject({
      name: "RequesterContextError",
      code: "requester_user_required",
    } satisfies Partial<RequesterContextError>);
  });

  it("fails closed when requester membership validation rejects the user", async () => {
    await expect(
      assembleRequesterContext(
        {
          tenantId: "tenant-1",
          computerId: "computer-sales",
          requesterUserId: "user-other-tenant",
          prompt: "Draft the launch brief",
        },
        {
          recall: { recall: vi.fn() },
          validateRequester: async () => false,
        },
      ),
    ).rejects.toMatchObject({
      code: "requester_not_in_tenant",
    });
  });

  it("does not leak one assigned user's memory into another user's request", async () => {
    const recall = {
      recall: vi.fn(async (request: { ownerId: string }) =>
        request.ownerId === "user-eric"
          ? [memory()]
          : [
              memory({
                record: {
                  ...memory().record,
                  id: "memory-amy-1",
                  ownerId: "user-amy",
                  content: {
                    summary: "Amy prefers detailed analysis",
                    text: "Amy prefers detailed analysis.",
                  },
                },
              }),
            ],
      ),
    };

    const eric = await assembleRequesterContext(
      {
        tenantId: "tenant-1",
        computerId: "computer-sales",
        requesterUserId: "user-eric",
        prompt: "Prepare this",
      },
      { recall, validateRequester: async () => true },
    );
    const amy = await assembleRequesterContext(
      {
        tenantId: "tenant-1",
        computerId: "computer-sales",
        requesterUserId: "user-amy",
        prompt: "Prepare this",
      },
      { recall, validateRequester: async () => true },
    );

    expect(
      eric.personalMemory.hits.map((hit) => hit.provenance.ownerId),
    ).toEqual(["user-eric"]);
    expect(
      amy.personalMemory.hits.map((hit) => hit.provenance.ownerId),
    ).toEqual(["user-amy"]);
  });

  it("keeps connector event metadata separate from personal memory", async () => {
    const result = await assembleRequesterContext(
      {
        tenantId: "tenant-1",
        computerId: "computer-sales",
        requesterUserId: "user-eric",
        prompt: "New email from Acme",
        contextClass: "personal_connector_event",
        sourceSurface: "gmail",
        credentialSubject: {
          type: "user",
          userId: "user-eric",
          connectionId: "connection-1",
          provider: "google_workspace",
        },
        event: {
          provider: "gmail",
          eventType: "message.created",
          eventId: "gmail-event-1",
          metadata: { from: "buyer@example.com" },
        },
      },
      {
        recall: { recall: vi.fn().mockResolvedValue([memory()]) },
        validateRequester: async () => true,
      },
    );

    expect(result.contextClass).toBe("personal_connector_event");
    expect(result.credentialSubject).toMatchObject({
      userId: "user-eric",
      connectionId: "connection-1",
    });
    expect(result.event).toMatchObject({
      provider: "gmail",
      eventType: "message.created",
      metadata: { from: "buyer@example.com" },
    });
    expect(result.personalMemory.hits[0].text).not.toContain(
      "buyer@example.com",
    );
  });

  it("rejects connector credential subjects for a different user", async () => {
    await expect(
      assembleRequesterContext(
        {
          tenantId: "tenant-1",
          computerId: "computer-sales",
          requesterUserId: "user-eric",
          prompt: "New email",
          contextClass: "personal_connector_event",
          credentialSubject: {
            type: "user",
            userId: "user-amy",
            provider: "google_workspace",
          },
        },
        { recall: { recall: vi.fn() }, validateRequester: async () => true },
      ),
    ).rejects.toMatchObject({
      code: "credential_subject_mismatch",
    });
  });
});
