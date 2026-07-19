import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  createHarnessPlatformToolsHandler,
  type HarnessPlatformToolsDeps,
} from "./harness-platform-tools-target.js";
import type { ToolExecutionEventInsert } from "../lib/harness/tool-execution-ledger.js";

const claims = {
  sub: "user-1",
  participant_id: "user-1",
  tenant_id: "tenant-1",
  space_id: "space-1",
  agent_id: "agent-1",
  thread_id: "thread-1",
  turn_id: "turn-1",
  session_generation: 1,
};

const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";

function event(
  path: string,
  body: Record<string, unknown>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: { authorization: "Bearer valid" },
    requestContext: {
      accountId: "account",
      apiId: "api",
      domainName: "example.test",
      domainPrefix: "example",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "gateway-tool-1",
      routeKey: "route",
      stage: "$default",
      time: "",
      timeEpoch: 0,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function setup(overrides: Partial<HarnessPlatformToolsDeps> = {}) {
  const rows: ToolExecutionEventInsert[] = [];
  let now = 1_000;
  const deps: HarnessPlatformToolsDeps = {
    verifyAccessToken: vi.fn(() => claims),
    resolveCanonicalContext: vi.fn(async () => ({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      triggeringMessageId: "message-1",
      spaceId: "space-1",
    })),
    resolveAccess: vi.fn(async () => ({ brain: true, email: true })),
    queryBrain: vi.fn<HarnessPlatformToolsDeps["queryBrain"]>(async () => ({
      query: "customer risks",
      mode: "results",
      scope: "auto",
      depth: "quick",
      hits: [
        {
          id: "brain-1",
          providerId: "brain-pages",
          family: "brain",
          sourceFamily: "brain",
          title: "Acme Corp",
          snippet: "Renewal risk is elevated.",
          scope: "team",
          provenance: {
            label: "ThinkWork Brain",
            uri: "brain://acme",
            metadata: { private: true },
          },
          metadata: { secret: true },
        },
      ],
      providers: [
        {
          providerId: "brain-pages",
          family: "brain",
          displayName: "ThinkWork Brain",
          state: "ok",
          scope: "team",
          hitCount: 1,
          metadata: { private: true },
        },
      ],
    })),
    sendEmail: vi.fn(async () => ({
      status: "pending_review",
      conversationId: "conversation-1",
      inboxItemId: "inbox-1",
      approvalUrl: "/approvals/inbox-1",
    })),
    listWorkspaceSkills: vi.fn(async () => ({
      manifestFingerprint: "manifest-1",
      skills: [
        { slug: "customer-qbr", scope: "space" as const },
        { slug: "private-notes", scope: "user" as const },
      ],
    })),
    loadWorkspaceSkill: vi.fn(async (_context, slug) => ({
      slug,
      scope: "space" as const,
      content: "# Customer QBR\nUse CRM evidence and charts.\n",
      contentSha256: "a".repeat(64),
      sizeBytes: 47,
      manifestFingerprint: "manifest-1",
    })),
    listMessageAttachments: vi.fn(async () => ({
      attachmentSetFingerprint: "attachment-set-1",
      attachments: [
        {
          attachmentId: ATTACHMENT_ID,
          name: "pipeline.csv",
          mimeType: "text/csv",
          sizeBytes: 42,
        },
      ],
    })),
    readMessageAttachment: vi.fn(async (_context, attachmentId, offset) => ({
      attachmentId,
      name: "pipeline.csv",
      mimeType: "text/csv",
      sizeBytes: 42,
      kind: "text" as const,
      content: "customer,amount\nAcme,1000\n",
      contentSha256: "b".repeat(64),
      offset,
      nextOffset: null,
      totalChars: 27,
      truncated: false,
    })),
    claimEmail: vi.fn<HarnessPlatformToolsDeps["claimEmail"]>(async () => ({
      state: "claimed",
    })),
    finishEmail: vi.fn(async () => undefined),
    ledgerStore: {
      async append(row) {
        rows.push(row);
        return { id: rows.length };
      },
    },
    policyRevision: "platform-tools-v1",
    now: () => (now += 10),
    ...overrides,
  };
  return { handler: createHarnessPlatformToolsHandler(deps), deps, rows };
}

describe("Harness governed platform tools target", () => {
  it("lists only sanitized attachments bound to the canonical triggering message", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/message/attachments/list", {
        tenant_id: "tenant-1",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      attachmentSetFingerprint: "attachment-set-1",
      attachments: [
        {
          attachmentId: ATTACHMENT_ID,
          name: "pipeline.csv",
          mimeType: "text/csv",
          sizeBytes: 42,
        },
      ],
    });
    expect(deps.listMessageAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ triggeringMessageId: "message-1" }),
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
  });

  it("reads a bounded attachment chunk without recording its content", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/message/attachments/read", {
        tenant_id: "tenant-1",
        attachment_id: ATTACHMENT_ID,
        offset: 0,
        max_chars: 4096,
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!).content).toContain("Acme,1000");
    expect(deps.readMessageAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ triggeringMessageId: "message-1" }),
      ATTACHMENT_ID,
      0,
      4096,
    );
    expect(JSON.stringify(rows)).not.toContain("Acme,1000");
    expect(JSON.stringify(rows)).not.toContain("pipeline.csv");
  });

  it("queries ThinkWork Brain under the canonical exact user and removes provider metadata", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/brain/query", {
        tenant_id: "tenant-1",
        query: "customer risks",
        limit: 5,
      }),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body.hits[0]).toEqual({
      id: "brain-1",
      title: "Acme Corp",
      snippet: "Renewal risk is elevated.",
      family: "brain",
      sourceFamily: "brain",
      provenance: { label: "ThinkWork Brain", uri: "brain://acme" },
    });
    expect(JSON.stringify(body)).not.toContain("private");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(deps.queryBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "customer risks",
        mode: "results",
        limit: 5,
        context: expect.objectContaining({ userId: "user-1" }),
      }),
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
  });

  it("routes email through the existing approval path after claiming a deterministic idempotency key", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/email/send", {
        tenant_id: "tenant-1",
        to: ["customer@example.com"],
        subject: "Follow up",
        content: "Hello from ThinkWork",
      }),
    );

    expect(result.statusCode).toBe(202);
    expect(JSON.parse(result.body!)).toEqual({
      status: "pending_review",
      conversationId: "conversation-1",
      inboxItemId: "inbox-1",
      approvalUrl: "/approvals/inbox-1",
    });
    expect(deps.claimEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^email:turn-1:[a-f0-9]{64}$/),
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(deps.finishEmail).toHaveBeenCalledWith(
      expect.objectContaining({ state: "completed" }),
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
    expect(rows[1]?.output_preview).toEqual({
      status: "pending_review",
      approvalRequested: true,
      inboxItemId: "inbox-1",
      approvalUrl: "/approvals/inbox-1",
    });
    expect(JSON.stringify(rows)).not.toContain("customer@example.com");
    expect(JSON.stringify(rows)).not.toContain("Hello from ThinkWork");
  });

  it("returns the cached email result without invoking the provider on replay", async () => {
    const { handler, deps, rows } = setup({
      claimEmail: vi.fn<HarnessPlatformToolsDeps["claimEmail"]>(async () => ({
        state: "replay" as const,
        result: { status: "sent", messageId: "message-1" },
      })),
    });
    const result = await handler(
      event("/agentcore/capabilities/email/send", {
        tenant_id: "tenant-1",
        to: ["customer@example.com"],
        subject: "Follow up",
        content: "Hello from ThinkWork",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      status: "sent",
      messageId: "message-1",
      replayed: true,
    });
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.finishEmail).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("parks an uncertain provider result as ambiguous instead of permitting a retry", async () => {
    const { handler, deps, rows } = setup({
      sendEmail: vi.fn(async () => {
        throw new Error("provider timeout after acceptance");
      }),
    });
    const result = await handler(
      event("/agentcore/capabilities/email/send", {
        tenant_id: "tenant-1",
        to: ["customer@example.com"],
        subject: "Follow up",
        content: "Hello from ThinkWork",
      }),
    );

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body!)).toEqual({ error: "send_email_ambiguous" });
    expect(deps.finishEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "ambiguous",
        failureReason: "provider_result_ambiguous",
      }),
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "uncertain"]);
  });

  it("fails closed when current agent policy blocks a platform tool", async () => {
    const { handler, deps, rows } = setup({
      resolveAccess: vi.fn(async () => ({ brain: false, email: false })),
    });
    const result = await handler(
      event("/agentcore/capabilities/brain/query", {
        tenant_id: "tenant-1",
        query: "customer risks",
      }),
    );

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body!)).toEqual({ error: "brain_not_authorized" });
    expect(deps.queryBrain).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("lists only the exact user's current canonical skill index", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/workspace/skills/list", {
        tenant_id: "tenant-1",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      manifestFingerprint: "manifest-1",
      skills: [
        { slug: "customer-qbr", scope: "space" },
        { slug: "private-notes", scope: "user" },
      ],
    });
    expect(deps.listWorkspaceSkills).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", turnId: "turn-1" }),
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
    expect(rows[1]?.output_preview).toEqual({ skillCount: 2 });
  });

  it("loads one canonical skill body and records only non-content evidence", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/workspace/skills/load", {
        tenant_id: "tenant-1",
        skill: "customer-qbr",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      slug: "customer-qbr",
      scope: "space",
      content: "# Customer QBR\nUse CRM evidence and charts.\n",
      contentSha256: "a".repeat(64),
      sizeBytes: 47,
      manifestFingerprint: "manifest-1",
    });
    expect(deps.loadWorkspaceSkill).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", turnId: "turn-1" }),
      "customer-qbr",
    );
    expect(rows.map((row) => row.event_type)).toEqual(["started", "completed"]);
    expect(JSON.stringify(rows)).not.toContain("Use CRM evidence");
    expect(rows[1]?.output_preview).toEqual({
      slug: "customer-qbr",
      scope: "space",
      sizeBytes: 47,
      contentSha256: "a".repeat(64),
      manifestFingerprint: "manifest-1",
    });
  });

  it("does not collapse an unauthorized skill into a model-invented success", async () => {
    const { handler, rows } = setup({
      loadWorkspaceSkill: vi.fn(async () => {
        const error = new Error("denied") as Error & { code: string };
        error.code = "workspace_skill_not_authorized";
        throw error;
      }),
    });
    const result = await handler(
      event("/agentcore/capabilities/workspace/skills/load", {
        tenant_id: "tenant-1",
        skill: "alice-private",
      }),
    );

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body!)).toEqual({
      error: "workspace_skill_not_authorized",
    });
    expect(rows.map((row) => row.event_type)).toEqual(["started", "failed"]);
  });

  it("rejects path traversal before the workspace reader is called", async () => {
    const { handler, deps, rows } = setup();
    const result = await handler(
      event("/agentcore/capabilities/workspace/skills/load", {
        tenant_id: "tenant-1",
        skill: "../private",
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body!)).toEqual({
      error: "invalid_workspace_skill",
    });
    expect(deps.loadWorkspaceSkill).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
