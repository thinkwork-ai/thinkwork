import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockRandomUUID,
  mockStartExecution,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockRandomUUID: vi.fn(),
  mockStartExecution: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: mockRandomUUID,
  };
});

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

let releasesMod: typeof import("./deploymentReleases.query.js");
let updateMod: typeof import("./startDeploymentReleaseUpdate.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mockRequireTenantAdmin.mockReset().mockResolvedValue("owner");
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mockRandomUUID
    .mockReset()
    .mockReturnValue("11111111-2222-3333-4444-555555555555");
  mockStartExecution.mockReset();
  releasesMod = await import("./deploymentReleases.query.js");
  updateMod = await import("./startDeploymentReleaseUpdate.mutation.js");
});

describe("deployment releases", () => {
  it("lists deployable release manifests with server-computed digests", async () => {
    const manifest = JSON.stringify({ schemaVersion: 1, version: "v1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            tag_name: "v0.1.0-canary.134",
            name: "canary.134",
            prerelease: true,
            draft: false,
            published_at: "2026-06-09T12:00:00Z",
            html_url:
              "https://github.com/thinkwork-ai/thinkwork/releases/tag/v0.1.0-canary.134",
            assets: [
              {
                name: "thinkwork-release.json",
                browser_download_url:
                  "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
              },
              {
                name: "thinkwork-release.json.sig",
                browser_download_url:
                  "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json.sig",
              },
            ],
          },
          {
            tag_name: "desktop-v0.1.0-canary.134",
            html_url:
              "https://github.com/thinkwork-ai/thinkwork/releases/tag/desktop-v0.1.0-canary.134",
            assets: [],
          },
        ]),
      )
      .mockResolvedValueOnce(bytesResponse(manifest));

    const result = await releasesMod.deploymentReleases(
      null,
      { limit: 5 },
      {} as any,
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      version: "v0.1.0-canary.134",
      name: "canary.134",
      signed: true,
      deployable: true,
      manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/thinkwork-ai/thinkwork/releases?per_page=5",
      expect.any(Object),
    );
  });

  it("starts a controller update for the selected release", async () => {
    vi.stubEnv("THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN", "arn:sfn:controller");
    vi.stubEnv("THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET", "evidence-bucket");
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    mockStartExecution.mockResolvedValue({
      executionArn: "arn:sfn:execution:update",
      stateMachineArn: "arn:sfn:controller",
    });
    const digest = "a".repeat(64);

    const result = await updateMod.startDeploymentReleaseUpdate(
      null,
      {
        input: {
          version: "v0.1.0-canary.134",
          manifestUrl:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
          manifestSha256: digest,
          idempotencyKey: "release-v0.1.0-canary.134",
        },
      },
      {} as any,
      { startExecution: mockStartExecution },
    );

    expect(mockRequireTenantAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartExecution.mock.invocationCallOrder[0],
    );
    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        stateMachineArn: "arn:sfn:controller",
        name: "tw-update-11111111222233334444555555555555",
        payload: expect.objectContaining({
          action: "update",
          phase: "update",
          environmentName: "dev",
          awsAccountId: "123456789012",
          release: {
            version: "v0.1.0-canary.134",
            manifestUrl:
              "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
            manifestSha256: digest,
          },
          features: {
            baseInstall: {
              cognee: false,
              slack: false,
              stripe: false,
              twenty: false,
            },
            optionalApps: [],
          },
        }),
      }),
    );
    expect(result.executionArn).toBe("arn:sfn:execution:update");
    expect(result.evidencePrefix).toContain(
      "settings/releases/v0.1.0-canary.134/",
    );
  });

  it("rejects non-admin callers before loading releases or starting updates", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );
    const fetchMock = vi.fn();

    await expect(
      releasesMod.deploymentReleases(null, {}, {} as any, {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/tenant admin/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function bytesResponse(body: string): Response {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}
