import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockRandomUUID,
  mockStartExecution,
  mockSsmSend,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockRandomUUID: vi.fn(),
  mockStartExecution: vi.fn(),
  mockSsmSend: vi.fn(),
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

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: vi.fn((input) => ({ input })),
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
  mockSsmSend.mockReset();
  releasesMod = await import("./deploymentReleases.query.js");
  updateMod = await import("./startDeploymentReleaseUpdate.mutation.js");
});

describe("deployment releases", () => {
  it("lists deployable release manifests with server-computed digests", async () => {
    const manifest134 = JSON.stringify({ schemaVersion: 1, version: "v134" });
    const manifest141 = JSON.stringify({ schemaVersion: 1, version: "v141" });
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
            tag_name: "v0.1.0-canary.141",
            name: "canary.141",
            prerelease: true,
            draft: false,
            published_at: "2026-06-09T22:44:23Z",
            html_url:
              "https://github.com/thinkwork-ai/thinkwork/releases/tag/v0.1.0-canary.141",
            assets: [
              {
                name: "thinkwork-release.json",
                browser_download_url:
                  "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.141/thinkwork-release.json",
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
      .mockResolvedValueOnce(bytesResponse(manifest141))
      .mockResolvedValueOnce(bytesResponse(manifest134));

    const result = await releasesMod.deploymentReleases(
      null,
      { limit: 5 },
      {} as any,
      { fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      version: "v0.1.0-canary.141",
      name: "canary.141",
      signed: false,
      deployable: true,
      manifestSha256: createHash("sha256").update(manifest141).digest("hex"),
    });
    expect(result[1]).toMatchObject({
      version: "v0.1.0-canary.134",
      name: "canary.134",
      signed: true,
      deployable: true,
      manifestSha256: createHash("sha256").update(manifest134).digest("hex"),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/thinkwork-ai/thinkwork/releases?per_page=100",
      expect.any(Object),
    );
  });

  it("rejects direct release updates before starting the controller", async () => {
    const digest = "a".repeat(64);

    await expect(
      updateMod.startDeploymentReleaseUpdate(
        null,
        {
          input: {
            version: "v0.1.0-canary.134",
            manifestUrl:
              "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
            manifestSha256: digest,
            idempotencyKey: "release-v0.1.0-canary.134",
          } as any,
        },
        {} as any,
        { startExecution: mockStartExecution },
      ),
    ).rejects.toThrow(/preflight/i);

    expect(mockStartExecution).not.toHaveBeenCalled();
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

describe("deployment releases caching", () => {
  const releasePayload = [
    {
      tag_name: "v0.1.0-canary.170",
      name: "canary.170",
      prerelease: true,
      draft: false,
      published_at: "2026-06-11T13:00:00Z",
      html_url:
        "https://github.com/thinkwork-ai/thinkwork/releases/tag/v0.1.0-canary.170",
      assets: [
        {
          name: "thinkwork-release.json",
          browser_download_url:
            "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.170/thinkwork-release.json",
        },
      ],
    },
  ];
  const manifest = JSON.stringify({ schemaVersion: 1, version: "v170" });

  it("serves the releases list and manifest digests from cache within the TTL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(releasePayload))
      .mockResolvedValueOnce(bytesResponse(manifest));

    const first = await releasesMod.deploymentReleases(null, {}, {} as any, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    const second = await releasesMod.deploymentReleases(null, {}, {} as any, {
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    // one list fetch + one manifest fetch total — the second query was
    // served entirely from cache
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves the last good list when the GitHub fetch fails (rate limit)", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(releasePayload))
      .mockResolvedValueOnce(bytesResponse(manifest))
      .mockResolvedValue({ ok: false, status: 403 } as Response);

    const first = await releasesMod.deploymentReleases(null, {}, {} as any, {
      fetch: fetchMock as unknown as typeof fetch,
    });
    // Jump past the TTL so the next query re-fetches the list and hits the
    // 403 — the cached list must be served instead of failing the panel.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    try {
      const stale = await releasesMod.deploymentReleases(null, {}, {} as any, {
        fetch: fetchMock as unknown as typeof fetch,
      });
      expect(first).toHaveLength(1);
      expect(stale).toEqual(first);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("serving stale release list"),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
      consoleWarn.mockRestore();
    }
  });

  it("still fails when GitHub is unavailable and no cache exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403 } as Response);

    await expect(
      releasesMod.deploymentReleases(null, {}, {} as any, {
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unable to load thinkwork releases/i);
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
