import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const configMap: Record<string, string | undefined> = {};
  const state = {
    caller: { userId: "user-1", tenantId: "tenant-1" } as {
      userId: string | null;
      tenantId: string | null;
    },
    adminError: null as Error | null,
    resolveConfigError: null as Error | null,
    rdsConfig: null as unknown,
    connectorError: null as Error | null,
    connectorOutcome: { action: "created", id: "srv-1" } as {
      action: string;
      id: string;
    },
    brokerOutcome: "created" as string,
    rdsOutcome: "created" as string,
    folder: { agents: 2, files: [], skipped: [] } as {
      agents: number;
      files: string[];
      skipped: unknown[];
    },
    lastEnv: undefined as Record<string, string | undefined> | undefined,
  };
  return { calls, configMap, state };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) => h.configMap[key],
}));

vi.mock("@thinkwork/database-pg/analyst", () => ({
  generateAnalystSchemaMarkdown: () => {
    h.calls.push("genSchema");
    return "# schema";
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: async () => {
    h.calls.push("requireAdmin");
    if (h.state.adminError) throw h.state.adminError;
    return "admin";
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: async () => h.state.caller,
}));

vi.mock("../../../lib/analyst/connection-folder.js", () => ({
  materializeAnalystConnectionFolder: async (input: { signedBy?: string }) => {
    h.calls.push(`materialize:signedBy=${input.signedBy}`);
    return h.state.folder;
  },
}));

vi.mock("../../../lib/analyst/provision-connector.js", () => ({
  resolveAnalystProvisionConfig: (env: Record<string, string | undefined>) => {
    h.calls.push("resolveConfig");
    if (h.state.resolveConfigError) throw h.state.resolveConfigError;
    h.state.lastEnv = env;
    return {
      tenantId: env.TENANT_ID,
      brokerUrl: "https://api.example/mcp/analyst",
      secretRef: "arn:aws:secretsmanager:us-east-1:1:secret:broker",
    };
  },
  resolveAnalystRdsIamConfig: () => {
    h.calls.push("resolveRds");
    return h.state.rdsConfig;
  },
  ensureAnalystBrokerSecret: async (input: { rotate?: boolean }) => {
    h.calls.push(`ensureBroker:rotate=${input.rotate}`);
    return h.state.brokerOutcome;
  },
  ensureAnalystRdsIamCredential: async () => {
    h.calls.push("ensureRds");
    return h.state.rdsOutcome;
  },
  provisionAnalystConnector: async (input: { reApprove?: boolean }) => {
    h.calls.push(`provision:reApprove=${input.reApprove}`);
    if (h.state.connectorError) throw h.state.connectorError;
    return h.state.connectorOutcome;
  },
  refreshAnalystProfileFromSeed: async () => {
    h.calls.push("refreshProfile");
  },
}));

const ctx = { auth: { email: "op@example.com" } } as never;

async function load() {
  const mod = await import("./provisionAnalystConnector.mutation.js");
  return mod.provisionAnalystConnector;
}

describe("provisionAnalystConnector", () => {
  beforeEach(() => {
    h.calls.length = 0;
    for (const k of Object.keys(h.configMap)) delete h.configMap[k];
    h.configMap.ANALYST_BROKER_SECRET_ARN =
      "arn:aws:secretsmanager:us-east-1:1:secret:broker";
    h.configMap.THINKWORK_API_URL = "https://api.example";
    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = null;
    h.state.resolveConfigError = null;
    h.state.rdsConfig = null;
    h.state.connectorError = null;
    h.state.connectorOutcome = { action: "created", id: "srv-1" };
    h.state.brokerOutcome = "created";
    h.state.rdsOutcome = "created";
    h.state.folder = { agents: 2, files: [], skipped: [] };
    h.state.lastEnv = undefined;
  });

  it("rejects a non-admin caller before running any ceremony step", async () => {
    h.state.adminError = new GraphQLError("Tenant admin role required", {
      extensions: { code: "FORBIDDEN" },
    });
    const resolver = await load();
    await expect(resolver(undefined, {}, ctx)).rejects.toThrow(
      "Tenant admin role required",
    );
    // Ceremony never started — only the auth gate ran.
    expect(h.calls).toEqual(["requireAdmin"]);
  });

  it("rejects when the caller has no tenant context", async () => {
    h.state.caller = { userId: "user-1", tenantId: null };
    const resolver = await load();
    await expect(resolver(undefined, {}, ctx)).rejects.toThrow(
      "Tenant context required",
    );
    expect(h.calls).toEqual([]);
  });

  it("runs the five ceremony steps in order and maps outcomes", async () => {
    h.state.connectorOutcome = { action: "re_approved", id: "srv-9" };
    h.state.brokerOutcome = "updated";
    h.state.folder = { agents: 3, files: [], skipped: [{}] };
    const resolver = await load();

    const result = await resolver(undefined, {}, ctx);

    expect(h.calls).toEqual([
      "requireAdmin",
      "resolveConfig",
      "ensureBroker:rotate=false",
      "resolveRds",
      "provision:reApprove=false",
      "refreshProfile",
      "genSchema",
      "materialize:signedBy=operator:op@example.com",
    ]);
    expect(result).toEqual({
      connectorId: "srv-9",
      connectorOutcome: "re_approved",
      brokerSecretOutcome: "updated",
      rdsIamCredentialOutcome: null,
      profileRefreshed: true,
      foldersWritten: 3,
      foldersSkipped: 1,
    });
    // TENANT_ID is caller-supplied, never a config key.
    expect(h.state.lastEnv?.TENANT_ID).toBe("tenant-1");
  });

  it("seeds the rds_iam credential row when the IAM env block is wired", async () => {
    h.state.rdsConfig = { tenantId: "tenant-1" };
    h.state.rdsOutcome = "created";
    const resolver = await load();

    const result = await resolver(undefined, {}, ctx);

    expect(h.calls).toContain("ensureRds");
    expect(result.rdsIamCredentialOutcome).toBe("created");
    // ensureRds runs between the broker secret and the registry row.
    expect(h.calls.indexOf("ensureRds")).toBeGreaterThan(
      h.calls.indexOf("ensureBroker:rotate=false"),
    );
    expect(h.calls.indexOf("ensureRds")).toBeLessThan(
      h.calls.indexOf("provision:reApprove=false"),
    );
  });

  it("forces re-approve when rotateToken is set", async () => {
    const resolver = await load();
    await resolver(undefined, { rotateToken: true }, ctx);
    expect(h.calls).toContain("ensureBroker:rotate=true");
    expect(h.calls).toContain("provision:reApprove=true");
  });

  it("passes reApprove through without a rotation", async () => {
    const resolver = await load();
    await resolver(undefined, { reApprove: true }, ctx);
    expect(h.calls).toContain("ensureBroker:rotate=false");
    expect(h.calls).toContain("provision:reApprove=true");
  });

  it("surfaces the lib's missing-broker-config error verbatim", async () => {
    h.state.resolveConfigError = new Error(
      "provision-analyst-connector: missing required env: ANALYST_BROKER_SECRET_ARN. Nothing was written.",
    );
    const resolver = await load();
    await expect(resolver(undefined, {}, ctx)).rejects.toThrow(
      "missing required env: ANALYST_BROKER_SECRET_ARN",
    );
    // Fails before any write step.
    expect(h.calls).toEqual(["requireAdmin", "resolveConfig"]);
  });

  it("surfaces the SI-5 re-approve error from provisionAnalystConnector", async () => {
    h.state.connectorError = new Error(
      'analyst connector "postgres-dev" already exists ... Re-run with --re-approve to rewrite it and restamp approval (SI-5).',
    );
    const resolver = await load();
    await expect(resolver(undefined, {}, ctx)).rejects.toThrow(
      "Re-run with --re-approve",
    );
  });

  it("falls back to the user id when the caller has no email", async () => {
    const noEmailCtx = { auth: { email: null } } as never;
    const resolver = await load();
    await resolver(undefined, {}, noEmailCtx);
    expect(h.calls).toContain("materialize:signedBy=operator:user-1");
  });
});
