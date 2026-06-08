import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockGetSecretValueCommand, mockStartManagedApplicationPlan } =
  vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockGetSecretValueCommand: vi.fn((input: unknown) => ({ input })),
    mockStartManagedApplicationPlan: vi.fn(),
  }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: mockGetSecretValueCommand,
}));

vi.mock("../deployments/startManagedApplicationPlan.mutation.js", () => ({
  startManagedApplicationPlan: mockStartManagedApplicationPlan,
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn(async () => null),
}));

let mod: typeof import("./setKnowledgeGraphDeployment.mutation.js");
let managedMod: typeof import("./setManagedApplicationDeployment.mutation.js");

const operatorCtx = {
  auth: {
    authType: "cognito",
    email: "ops@example.com",
    principalId: "user-1",
  },
} as any;

beforeEach(async () => {
  vi.resetModules();
  mockSend.mockReset();
  mockGetSecretValueCommand.mockClear();
  mockStartManagedApplicationPlan.mockReset().mockResolvedValue({
    planExecutionArn: "arn:sfn:execution:plan",
  });
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
  it("queues a Cognee deployment plan instead of dispatching GitHub Actions", async () => {
    const result = await mod.setKnowledgeGraphDeployment(
      null,
      { input: { enabled: true } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      desiredEnabled: true,
      workflowUrl: "arn:sfn:execution:plan",
      message: "Knowledge Graph enable deployment plan queued.",
    });
    expect(mockGetSecretValueCommand).not.toHaveBeenCalled();
    expect(mockStartManagedApplicationPlan).toHaveBeenCalledWith(
      null,
      {
        input: expect.objectContaining({
          key: "cognee",
          operation: "ENABLE",
        }),
      },
      operatorCtx,
    );
  });

  it("passes explicit idempotency keys through to the deployment job API", async () => {
    await mod.setKnowledgeGraphDeployment(
      null,
      { input: { enabled: false, idempotencyKey: "kg-disable-1" } },
      operatorCtx,
    );

    expect(mockStartManagedApplicationPlan).toHaveBeenCalledWith(
      null,
      {
        input: {
          key: "cognee",
          operation: "DESTROY",
          idempotencyKey: "kg-disable-1",
        },
      },
      operatorCtx,
    );
  });

  it("surfaces deployment-job authorization failures", async () => {
    mockStartManagedApplicationPlan.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );

    await expect(
      mod.setKnowledgeGraphDeployment(null, { input: { enabled: true } }, {
        auth: { authType: "cognito", email: "member@example.com" },
      } as any),
    ).rejects.toThrow(/tenant admin/i);
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
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await managedMod.setManagedApplicationDeployment(
      null,
      { input: { key: "twenty", action: "ENABLE" } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      key: "twenty",
      action: "ENABLE",
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
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_DESTROY_DATA",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "TWENTY_DESTROY_DATA",
          value: "false",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
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
      action: "PARK",
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_DESTROY_DATA",
      expect.objectContaining({
        body: JSON.stringify({
          name: "TWENTY_DESTROY_DATA",
          value: "false",
        }),
      }),
    );
  });

  it("destroys Twenty runtime and retained data when explicitly requested", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "plain-token" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await managedMod.setManagedApplicationDeployment(
      null,
      { input: { key: "twenty", action: "DESTROY" } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      key: "twenty",
      action: "DESTROY",
      desiredEnabled: false,
      provisioned: false,
      runtimeEnabled: false,
    });
    expect(result.message).toMatch(/destructive cleanup/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_PROVISIONED",
      expect.objectContaining({
        body: JSON.stringify({ name: "TWENTY_PROVISIONED", value: "false" }),
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/TWENTY_DESTROY_DATA",
      expect.objectContaining({
        body: JSON.stringify({ name: "TWENTY_DESTROY_DATA", value: "true" }),
      }),
    );
  });

  it("parks Kestra runtime while retaining orchestration data", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "plain-token" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await managedMod.setManagedApplicationDeployment(
      null,
      { input: { key: "orchestration", enabled: false } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      key: "kestra",
      action: "PARK",
      desiredEnabled: false,
      provisioned: true,
      runtimeEnabled: false,
    });
    expect(result.message).toMatch(/retained/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/KESTRA_PROVISIONED",
      expect.objectContaining({
        body: JSON.stringify({ name: "KESTRA_PROVISIONED", value: "true" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/KESTRA_RUNTIME_ENABLED",
      expect.objectContaining({
        body: JSON.stringify({
          name: "KESTRA_RUNTIME_ENABLED",
          value: "false",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/KESTRA_DESTROY_DATA",
      expect.objectContaining({
        body: JSON.stringify({
          name: "KESTRA_DESTROY_DATA",
          value: "false",
        }),
      }),
    );
  });

  it("destroys Kestra runtime and retained data when explicitly requested", async () => {
    mockSend.mockResolvedValueOnce({ SecretString: "plain-token" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204));
    vi.stubGlobal("fetch", fetchMock);

    const result = await managedMod.setManagedApplicationDeployment(
      null,
      { input: { key: "kestra", action: "DESTROY" } },
      operatorCtx,
    );

    expect(result).toMatchObject({
      key: "kestra",
      action: "DESTROY",
      desiredEnabled: false,
      provisioned: false,
      runtimeEnabled: false,
    });
    expect(result.message).toMatch(/destructive cleanup/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/KESTRA_PROVISIONED",
      expect.objectContaining({
        body: JSON.stringify({ name: "KESTRA_PROVISIONED", value: "false" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/KESTRA_RUNTIME_ENABLED",
      expect.objectContaining({
        body: JSON.stringify({
          name: "KESTRA_RUNTIME_ENABLED",
          value: "false",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/thinkwork-ai/thinkwork/actions/variables/KESTRA_DESTROY_DATA",
      expect.objectContaining({
        body: JSON.stringify({ name: "KESTRA_DESTROY_DATA", value: "true" }),
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
