import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockGetSecretValueCommand } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSecretValueCommand: vi.fn((input: unknown) => ({ input })),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: mockGetSecretValueCommand,
}));

let mod: typeof import("./setKnowledgeGraphDeployment.mutation.js");
let managedMod: typeof import("./setManagedApplicationDeployment.mutation.js");

const operatorCtx = {
  auth: { authType: "cognito", email: "ops@example.com" },
} as any;

beforeEach(async () => {
  vi.resetModules();
  mockSend.mockReset();
  mockGetSecretValueCommand.mockClear();
  vi.stubEnv("STAGE", "dev");
  vi.stubEnv("THINKWORK_PLATFORM_OPERATOR_EMAILS", "ops@example.com");
  vi.stubEnv("KNOWLEDGE_GRAPH_DEPLOY_REPOSITORY", "thinkwork-ai/thinkwork");
  vi.stubEnv("KNOWLEDGE_GRAPH_DEPLOY_WORKFLOW_FILE", "deploy.yml");
  vi.stubEnv("KNOWLEDGE_GRAPH_DEPLOY_REF", "main");
  vi.unstubAllGlobals();
  mod = await import("./setKnowledgeGraphDeployment.mutation.js");
  managedMod = await import("./setManagedApplicationDeployment.mutation.js");
});

describe("setKnowledgeGraphDeployment", () => {
  it("updates the Cognee deploy variable and dispatches the deploy workflow", async () => {
    mockSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ token: "gh-token" }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mod.setKnowledgeGraphDeployment(
      null,
      { input: { enabled: true } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      desiredEnabled: true,
      workflowUrl:
        "https://github.com/thinkwork-ai/thinkwork/actions/workflows/deploy.yml",
    });
    expect(mockGetSecretValueCommand).toHaveBeenCalledWith({
      SecretId: "thinkwork/dev/github/deploy-token",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/COGNEE_ENABLED",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "COGNEE_ENABLED", value: "true" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/workflows/deploy.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "main" }),
      }),
    );
  });

  it("creates the GitHub Actions variable when it does not exist yet", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "plain-token" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(404, { message: "Not Found" }))
      .mockResolvedValueOnce(response(201, { name: "COGNEE_ENABLED" }))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    await mod.setKnowledgeGraphDeployment(
      null,
      { input: { enabled: false } },
      operatorCtx,
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "COGNEE_ENABLED", value: "false" }),
      }),
    );
  });

  it("rejects callers outside the platform-operator allowlist", async () => {
    await expect(
      mod.setKnowledgeGraphDeployment(null, { input: { enabled: true } }, {
        auth: { authType: "cognito", email: "member@example.com" },
      } as any),
    ).rejects.toThrow(/platform-operator/);
  });
});

describe("setManagedApplicationDeployment", () => {
  it("enables Twenty by setting provisioned and runtime deploy variables", async () => {
    mockSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ token: "gh-token" }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await managedMod.setManagedApplicationDeployment(
      null,
      { input: { key: "twenty", enabled: true } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      key: "twenty",
      desiredEnabled: true,
      provisioned: true,
      runtimeEnabled: true,
      message: "Twenty CRM enable deployment queued.",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_PROVISIONED",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "TWENTY_PROVISIONED", value: "true" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_RUNTIME_ENABLED",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "TWENTY_RUNTIME_ENABLED",
          value: "true",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/workflows/deploy.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ref: "main" }),
      }),
    );
  });

  it("parks Twenty runtime while retaining the provisioned resources", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "plain-token" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await managedMod.setManagedApplicationDeployment(
      null,
      { input: { key: "crm", enabled: false } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      key: "twenty",
      desiredEnabled: false,
      provisioned: true,
      runtimeEnabled: false,
    });
    expect(result.message).toMatch(/retained/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_PROVISIONED",
      expect.objectContaining({
        body: JSON.stringify({ name: "TWENTY_PROVISIONED", value: "true" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_RUNTIME_ENABLED",
      expect.objectContaining({
        body: JSON.stringify({
          name: "TWENTY_RUNTIME_ENABLED",
          value: "false",
        }),
      }),
    );
  });

  it("rejects non-platform operators before updating managed apps", async () => {
    await expect(
      managedMod.setManagedApplicationDeployment(
        null,
        { input: { key: "twenty", enabled: true } },
        { auth: { authType: "cognito", email: "member@example.com" } } as any,
      ),
    ).rejects.toThrow(/platform-operator/);
  });
});

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
  };
}
