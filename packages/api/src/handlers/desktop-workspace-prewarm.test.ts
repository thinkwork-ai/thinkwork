import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  prepareLocalPiWorkspacePrewarm: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mocks.authenticate,
}));

vi.mock("../lib/desktop-runtime/prepare-local-turn.js", () => {
  class DesktopRuntimeSessionError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = "DesktopRuntimeSessionError";
    }
  }
  return {
    DesktopRuntimeSessionError,
    prepareLocalPiWorkspacePrewarm: mocks.prepareLocalPiWorkspacePrewarm,
  };
});

import { handler } from "./desktop-workspace-prewarm.js";

const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const SPACE_ID = "55555555-5555-5555-5555-555555555555";

function event(
  overrides: Record<string, unknown> = {},
): Parameters<typeof handler>[0] {
  return {
    requestContext: {
      http: {
        method:
          typeof overrides.method === "string" ? overrides.method : "POST",
        path: "/api/desktop/workspace-prewarm",
      },
    },
    headers: { authorization: "Bearer token" },
    body:
      overrides.body === undefined
        ? JSON.stringify({
            agentId: AGENT_ID,
            spaceId: SPACE_ID,
          })
        : (overrides.body as string),
  } as unknown as Parameters<typeof handler>[0];
}

describe("desktop-workspace-prewarm handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      authType: "cognito",
      email: "user@example.com",
      principalId: "cognito-sub",
      tenantId: null,
      agentId: null,
    });
    mocks.prepareLocalPiWorkspacePrewarm.mockResolvedValue({
      expiresAt: "2026-05-28T13:00:00.000Z",
      sidecarCredentials: {
        mode: "desktop-sidecar-session",
        expiresAt: "2026-05-28T13:00:00.000Z",
      },
      workspace: {
        bucket: "workspace-bucket",
        renderedPrefix: "tenants/acme/rendered/marco/default/user-1/",
      },
      partition: {
        tenantSlug: "acme",
        agentSlug: "marco",
        spaceId: SPACE_ID,
        userId: "user-1",
      },
    });
  });

  it("requires a Cognito user caller", async () => {
    mocks.authenticate.mockResolvedValue({
      authType: "service",
      email: null,
      principalId: null,
      tenantId: null,
      agentId: null,
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(401);
    expect(mocks.prepareLocalPiWorkspacePrewarm).not.toHaveBeenCalled();
  });

  it("returns a workspace prewarm session without creating a turn", async () => {
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.ok).toBe(true);
    expect(body.session.workspace.bucket).toBe("workspace-bucket");
    expect(body.session.partition.agentSlug).toBe("marco");
    expect(mocks.prepareLocalPiWorkspacePrewarm).toHaveBeenCalledWith({
      auth: expect.objectContaining({ authType: "cognito" }),
      agentId: AGENT_ID,
      spaceId: SPACE_ID,
    });
  });

  it("rejects invalid JSON before preparing a prewarm session", async () => {
    const res = await handler(event({ body: "{ nope" }));
    expect(res.statusCode).toBe(400);
    expect(mocks.prepareLocalPiWorkspacePrewarm).not.toHaveBeenCalled();
  });
});
