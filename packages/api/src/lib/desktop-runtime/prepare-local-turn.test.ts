import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopRuntimeSessionError,
  prepareLocalPiRuntimeSession,
  type PrepareLocalPiRuntimeSessionDeps,
} from "./prepare-local-turn.js";
import { assertNoStaticServiceSecrets } from "./sidecar-credentials.js";

vi.mock("../db.js", () => ({ db: {} }));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const THREAD_ID = "44444444-4444-4444-4444-444444444444";
const SPACE_ID = "55555555-5555-5555-5555-555555555555";
const TURN_ID = "66666666-6666-6666-6666-666666666666";

function runtimeConfig(overrides = {}) {
  return {
    tenantId: TENANT_ID,
    tenantSlug: "acme",
    agentId: AGENT_ID,
    agentName: "Pi",
    agentSlug: "pi",
    agentSystemPrompt: "Help",
    humanName: "Human",
    humanPairId: USER_ID,
    templateId: null,
    templateModel: "anthropic.claude-3-5-sonnet",
    budgetMonthlyCents: null,
    budgetPaused: false,
    blockedTools: ["managed-computer-use"],
    sandboxTemplate: null,
    browserAutomationEnabled: true,
    contextEngineEnabled: false,
    guardrailId: null,
    guardrailConfig: undefined,
    runtimeType: "pi",
    skillsConfig: [],
    webSearchConfig: { enabled: true },
    sendEmailConfig: {
      agentId: AGENT_ID,
      tenantId: TENANT_ID,
      apiUrl: "https://api.example.com",
      apiSecret: "SHOULD_NOT_LEAK",
    },
    knowledgeBasesConfig: undefined,
    mcpConfigs: [],
    ...overrides,
  } as any;
}

function makeDeps(
  overrides: Partial<PrepareLocalPiRuntimeSessionDeps> = {},
): PrepareLocalPiRuntimeSessionDeps {
  return {
    now: () => new Date("2026-05-28T12:00:00.000Z"),
    loadCallerByEmail: vi.fn(async () => ({
      id: USER_ID,
      tenantId: TENANT_ID,
      email: "user@example.com",
      name: "User",
    })),
    loadTenantMembership: vi.fn(async () => ({
      role: "member",
      status: "active",
    })),
    loadThreadForAccess: vi.fn(async () => ({
      id: THREAD_ID,
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      spaceId: SPACE_ID,
    })),
    loadSpaceForAccess: vi.fn(async () => ({
      id: SPACE_ID,
      slug: "launch",
      accessMode: "private",
      status: "active",
    })),
    loadSpaceMembership: vi.fn(async () => ({ role: "member" })),
    resolveRuntimeConfig: vi.fn(async () => runtimeConfig()),
    loadMessageHistory: vi.fn(async () => [
      { role: "assistant", content: "previous answer" },
      { role: "user", content: "previous question" },
    ]),
    renderWorkspace: vi.fn(async () => ({
      rendered: true,
      renderedPrefix: `tenants/acme/threads/${THREAD_ID}/`,
      activeSpace: {
        id: SPACE_ID,
        slug: "launch",
        name: "Launch",
        isDefault: false,
      },
      effectivePolicy: {
        blockedTools: ["managed-computer-use", "send_email"],
        allowedTools: null,
        mcpAllowedServers: null,
        mcpBlockedServers: [],
        diagnostics: [],
      },
    })),
    countThreadTurns: vi.fn(async () => 2),
    createThreadTurn: vi.fn(async () => ({ id: TURN_ID })),
    updateTurnWakeupRequestId: vi.fn(async () => {}),
    notifyTurnStarted: vi.fn(async () => {}),
    getTraceId: () => "trace-1",
    presignAttachmentDownload: vi.fn(
      async ({ key }: { bucket: string; key: string }) =>
        `https://signed.example/${key}`,
    ),
    env: {
      thinkworkApiUrl: "https://api.example.com",
      workspaceBucket: "bucket",
      hindsightEndpoint: undefined,
    },
    ...overrides,
  };
}

describe("prepareLocalPiRuntimeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a local desktop turn after tenant, thread, and Space access pass", async () => {
    const deps = makeDeps();

    const session = await prepareLocalPiRuntimeSession(
      {
        auth: {
          authType: "cognito",
          email: "USER@example.com",
          principalId: "cognito-sub",
          tenantId: null,
          agentId: null,
        },
        agentId: AGENT_ID,
        threadId: THREAD_ID,
        userMessage: "Please help",
      },
      deps,
    );

    expect(session.threadTurnId).toBe(TURN_ID);
    expect(session.finalizeCallbackSecret).toMatch(/^dps_/);
    expect(session.finalizeCallbackUrl).toBe(
      `https://api.example.com/api/threads/${THREAD_ID}/finalize`,
    );
    expect(session.sidecarCredentials.hindsight.endpoint).toBeNull();
    expect(() =>
      assertNoStaticServiceSecrets(session.sidecarCredentials),
    ).not.toThrow();
    expect(session.invocation.thread_turn_id).toBe(TURN_ID);
    expect(session.invocation.pi_sdk).toMatchObject({
      packageName: "@earendil-works/pi-coding-agent",
      sessionFactory: "createAgentSession",
      runtimeFactory: "createAgentSessionRuntime",
    });
    expect(session.invocation.runtime_host).toBe("desktop-local");
    expect(session.invocation.rendered_workspace_prefix).toBe(
      `tenants/acme/threads/${THREAD_ID}/`,
    );
    expect(session.invocation.send_email_config).toBeUndefined();
    expect(JSON.stringify(session)).not.toContain("SHOULD_NOT_LEAK");
    expect(deps.createThreadTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turnNumber: 3,
        contextSnapshot: expect.objectContaining({
          dispatcher: "desktop-runtime-session",
          runtime_host: "desktop-local",
          desktop_runtime_session: expect.objectContaining({
            caller_user_id: USER_ID,
            caller_email: "user@example.com",
          }),
        }),
      }),
    );
  });

  it("attaches a presigned download_url to each message attachment", async () => {
    const deps = makeDeps();

    const session = await prepareLocalPiRuntimeSession(
      {
        auth: {
          authType: "cognito",
          email: "user@example.com",
          principalId: "cognito-sub",
          tenantId: null,
          agentId: null,
        },
        agentId: AGENT_ID,
        threadId: THREAD_ID,
        userMessage: "Analyze this GL file",
        messageAttachments: [
          {
            attachmentId: "att-1",
            s3Key: `tenants/acme/attachments/${THREAD_ID}/att-1/General-Ledger.xlsx`,
            name: "General-Ledger.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 1024,
          },
        ],
      },
      deps,
    );

    expect(deps.presignAttachmentDownload).toHaveBeenCalledWith({
      bucket: "bucket",
      key: `tenants/acme/attachments/${THREAD_ID}/att-1/General-Ledger.xlsx`,
    });
    expect(session.invocation.message_attachments).toEqual([
      expect.objectContaining({
        attachment_id: "att-1",
        name: "General-Ledger.xlsx",
        download_url: `https://signed.example/tenants/acme/attachments/${THREAD_ID}/att-1/General-Ledger.xlsx`,
      }),
    ]);
  });

  it("drops attachments that cannot be presigned", async () => {
    const deps = makeDeps({
      presignAttachmentDownload: vi.fn(async () => null),
    });

    const session = await prepareLocalPiRuntimeSession(
      {
        auth: {
          authType: "cognito",
          email: "user@example.com",
          principalId: "cognito-sub",
          tenantId: null,
          agentId: null,
        },
        agentId: AGENT_ID,
        threadId: THREAD_ID,
        userMessage: "Analyze this GL file",
        messageAttachments: [
          {
            attachmentId: "att-1",
            s3Key: `tenants/acme/attachments/${THREAD_ID}/att-1/x.xlsx`,
            name: "x.xlsx",
            mimeType: "application/vnd.ms-excel",
            sizeBytes: 1024,
          },
        ],
      },
      deps,
    );

    expect(session.invocation.message_attachments).toBeUndefined();
  });

  it("denies private Space access before creating a turn or credentials", async () => {
    const deps = makeDeps({
      loadSpaceMembership: vi.fn(async () => null),
    });

    await expect(
      prepareLocalPiRuntimeSession(
        {
          auth: {
            authType: "cognito",
            email: "user@example.com",
            principalId: "cognito-sub",
            tenantId: TENANT_ID,
            agentId: null,
          },
          agentId: AGENT_ID,
          threadId: THREAD_ID,
          userMessage: "Please help",
        },
        deps,
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SPACE_ACCESS_DENIED",
    });
    expect(deps.createThreadTurn).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace renderer reports cross-tenant Space denial", async () => {
    const deps = makeDeps({
      renderWorkspace: vi.fn(async () => ({
        rendered: false,
        errorCode: "SpaceAccessDenied",
        reason: "tenant mismatch",
      })),
    });

    await expect(
      prepareLocalPiRuntimeSession(
        {
          auth: {
            authType: "cognito",
            email: "user@example.com",
            principalId: "cognito-sub",
            tenantId: TENANT_ID,
            agentId: null,
          },
          agentId: AGENT_ID,
          threadId: THREAD_ID,
          userMessage: "Please help",
        },
        deps,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "SPACE_ACCESS_DENIED" });
    expect(deps.createThreadTurn).not.toHaveBeenCalled();
  });

  it("stores only the finalize token hash in the turn context", async () => {
    const deps = makeDeps();
    const session = await prepareLocalPiRuntimeSession(
      {
        auth: {
          authType: "cognito",
          email: "user@example.com",
          principalId: "cognito-sub",
          tenantId: TENANT_ID,
          agentId: null,
        },
        agentId: AGENT_ID,
        threadId: THREAD_ID,
        userMessage: "Please help",
      },
      deps,
    );

    const createInput = vi.mocked(deps.createThreadTurn).mock.calls[0][0];
    const desktopSession = (createInput.contextSnapshot as any)
      .desktop_runtime_session;
    expect(desktopSession.finalize_token_sha256).toBe(
      createHash("sha256")
        .update(session.finalizeCallbackSecret, "utf8")
        .digest("hex"),
    );
    expect(JSON.stringify(createInput.contextSnapshot)).not.toContain(
      session.finalizeCallbackSecret,
    );
  });
});
