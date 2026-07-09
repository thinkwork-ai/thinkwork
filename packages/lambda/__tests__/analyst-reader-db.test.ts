/**
 * analyst-reader-db connect-strategy tests (THINK-229 U1).
 *
 * Covers the trust-anchored credential chain: IAM-token minting with
 * verified TLS, the one-fresh-token retry, the pre-grant password
 * fallback, warm-client reuse past token expiry, and re-mint on
 * reconnect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mintCalls, connectAttempts, clientBehavior, secretsManagerMock } =
  vi.hoisted(() => {
    const state = {
      mintCalls: [] as Array<Record<string, unknown>>,
      connectAttempts: [] as Array<Record<string, unknown>>,
      clientBehavior: {
        // Per-attempt outcomes keyed by attempt index; default success.
        failures: [] as Array<string | null>,
      },
      secretsManagerMock: {
        secretString: JSON.stringify({
          username: "analyst_reader",
          password: "fallback-pass",
          host: "db.example.com",
          port: 5432,
          dbname: "thinkwork",
        }),
        calls: 0,
      },
    };
    return state;
  });

vi.mock("@aws-sdk/rds-signer", () => ({
  Signer: class {
    private config: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
    async getAuthToken(): Promise<string> {
      mintCalls.push(this.config);
      return `iam-token-${mintCalls.length}`;
    }
  },
}));

vi.mock("pg", () => ({
  Client: class {
    config: Record<string, unknown>;
    private handlers = new Map<string, () => void>();
    constructor(config: Record<string, unknown>) {
      this.config = config;
    }
    async connect(): Promise<void> {
      const attemptIndex = connectAttempts.length;
      connectAttempts.push(this.config);
      const failure = clientBehavior.failures[attemptIndex];
      if (failure) throw new Error(failure);
    }
    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }
    _emitError(): void {
      this.handlers.get("error")?.();
    }
    async end(): Promise<void> {}
  },
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  GetSecretValueCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  SecretsManagerClient: class {
    async send(): Promise<{ SecretString: string }> {
      secretsManagerMock.calls += 1;
      return { SecretString: secretsManagerMock.secretString };
    }
  },
}));

const IAM_ENV = {
  ANALYST_DB_CLUSTER_ENDPOINT:
    "thinkwork-dev-db.cluster-abc.us-east-1.rds.amazonaws.com",
  ANALYST_DB_NAME: "thinkwork",
  ANALYST_DB_USER: "analyst_reader",
  ANALYST_DB_PORT: "5432",
  AWS_REGION: "us-east-1",
};

async function loadModule() {
  return import("../analyst-reader-db.js");
}

describe("analyst-reader-db (THINK-229 U1)", () => {
  beforeEach(() => {
    vi.resetModules();
    mintCalls.length = 0;
    connectAttempts.length = 0;
    clientBehavior.failures = [];
    secretsManagerMock.calls = 0;
    delete process.env.ANALYST_READER_DATABASE_URL;
    delete process.env.ANALYST_READER_SECRET_ARN;
    for (const [key, value] of Object.entries(IAM_ENV)) {
      process.env[key] = value;
    }
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of Object.keys(IAM_ENV)) delete process.env[key];
    vi.restoreAllMocks();
  });

  it("token path: mints via Signer with cluster endpoint + role, uses token as password, verified TLS with bundled CA", async () => {
    const mod = await loadModule();
    await mod.getAnalystReaderClient();

    expect(mintCalls).toHaveLength(1);
    expect(mintCalls[0]).toMatchObject({
      hostname: IAM_ENV.ANALYST_DB_CLUSTER_ENDPOINT,
      port: 5432,
      username: "analyst_reader",
      region: "us-east-1",
    });

    expect(connectAttempts).toHaveLength(1);
    const config = connectAttempts[0]!;
    expect(config.password).toBe("iam-token-1");
    expect(config.user).toBe("analyst_reader");
    const ssl = config.ssl as { ca: string; rejectUnauthorized: boolean };
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toContain("BEGIN CERTIFICATE");
    // Never touched Secrets Manager on the IAM path.
    expect(secretsManagerMock.calls).toBe(0);
  });

  it("retry: transient IAM failure gets exactly one fresh-token retry, then the error surfaces verbatim", async () => {
    clientBehavior.failures = [
      "PAM authentication failed for user",
      "PAM authentication failed for user",
    ];
    const mod = await loadModule();
    await expect(mod.getAnalystReaderClient()).rejects.toThrow(
      "PAM authentication failed",
    );
    // Two attempts, each with a freshly minted token — never a reused one.
    expect(mintCalls).toHaveLength(2);
    expect(connectAttempts).toHaveLength(2);
    expect(connectAttempts[0]!.password).toBe("iam-token-1");
    expect(connectAttempts[1]!.password).toBe("iam-token-2");
  });

  it("fallback: IAM rejected + password secret present → password connect succeeds, both strategies logged", async () => {
    process.env.ANALYST_READER_SECRET_ARN = "arn:aws:secretsmanager:sec";
    clientBehavior.failures = [
      "password authentication failed",
      "password authentication failed",
      null,
    ];
    const mod = await loadModule();
    const client = await mod.getAnalystReaderClient();
    expect(client).toBeDefined();

    expect(connectAttempts).toHaveLength(3);
    // Third attempt is the password path — explicit config with the SAME
    // verified-TLS posture as the IAM path (no-verify is retired).
    const fallbackConfig = connectAttempts[2]!;
    expect(fallbackConfig.password).toBe("fallback-pass");
    expect(fallbackConfig.host).toBe("db.example.com");
    const fallbackSsl = fallbackConfig.ssl as {
      ca: string;
      rejectUnauthorized: boolean;
    };
    expect(fallbackSsl.rejectUnauthorized).toBe(true);
    expect(fallbackSsl.ca).toContain("BEGIN CERTIFICATE");
    expect(secretsManagerMock.calls).toBe(1);

    const logged = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("analyst-reader-db.connect"));
    expect(logged.some((l) => l.includes('"strategy":"iam"'))).toBe(true);
    expect(logged.some((l) => l.includes('"strategy":"password"'))).toBe(true);
  });

  it("downgrade guard: transport-shaped IAM failures rethrow instead of falling back to the password path", async () => {
    process.env.ANALYST_READER_SECRET_ARN = "arn:aws:secretsmanager:sec";
    clientBehavior.failures = [
      "connect ECONNREFUSED 10.0.0.1:5432",
      "connect ECONNREFUSED 10.0.0.1:5432",
    ];
    const mod = await loadModule();
    await expect(mod.getAnalystReaderClient()).rejects.toThrow("ECONNREFUSED");
    // Never reached Secrets Manager — the fallback is auth-gated.
    expect(connectAttempts).toHaveLength(2);
    expect(secretsManagerMock.calls).toBe(0);
  });

  it("retry success: transient first failure, second fresh-token attempt carries — no fallback", async () => {
    process.env.ANALYST_READER_SECRET_ARN = "arn:aws:secretsmanager:sec";
    clientBehavior.failures = ["PAM authentication failed for user", null];
    const mod = await loadModule();
    const client = await mod.getAnalystReaderClient();
    expect(client).toBeDefined();
    expect(mintCalls).toHaveLength(2);
    expect(connectAttempts).toHaveLength(2);
    expect(connectAttempts[1]!.password).toBe("iam-token-2");
    expect(secretsManagerMock.calls).toBe(0);
  });

  it("connect timeout is set on both IAM and password paths", async () => {
    process.env.ANALYST_READER_SECRET_ARN = "arn:aws:secretsmanager:sec";
    clientBehavior.failures = [
      "password authentication failed",
      "password authentication failed",
      null,
    ];
    const mod = await loadModule();
    await mod.getAnalystReaderClient();
    for (const attempt of connectAttempts) {
      expect(attempt.connectionTimeoutMillis).toBe(5000);
    }
  });

  it("reuse: warm client is returned without re-minting; re-mint happens on reconnect after a connection error", async () => {
    const mod = await loadModule();
    const first = await mod.getAnalystReaderClient();
    const again = await mod.getAnalystReaderClient();
    expect(again).toBe(first);
    expect(mintCalls).toHaveLength(1);

    // Simulate ECONNRESET: the error handler clears the cache; the next
    // call reconnects with a FRESH token.
    (first as unknown as { _emitError: () => void })._emitError();
    const reconnected = await mod.getAnalystReaderClient();
    expect(reconnected).not.toBe(first);
    expect(mintCalls).toHaveLength(2);
    expect(connectAttempts[1]!.password).toBe("iam-token-2");
  });

  it("no IAM env + no secret → loud provisioning error", async () => {
    for (const key of Object.keys(IAM_ENV)) delete process.env[key];
    const mod = await loadModule();
    await expect(mod.getAnalystReaderClient()).rejects.toThrow(
      /neither ANALYST_DB_CLUSTER_ENDPOINT.*nor ANALYST_READER_SECRET_ARN/,
    );
  });

  it("ANALYST_READER_DATABASE_URL escape hatch bypasses both IAM and Secrets Manager", async () => {
    process.env.ANALYST_READER_DATABASE_URL =
      "postgresql://analyst_reader:x@localhost:5439/analyst_test";
    const mod = await loadModule();
    await mod.getAnalystReaderClient();
    expect(mintCalls).toHaveLength(0);
    expect(secretsManagerMock.calls).toBe(0);
    expect(connectAttempts[0]!.connectionString).toContain("localhost:5439");
  });

  it("resolveIamConnectConfig: absent endpoint → null; defaults applied", async () => {
    const mod = await loadModule();
    expect(mod.resolveIamConnectConfig({})).toBeNull();
    expect(
      mod.resolveIamConnectConfig({
        ANALYST_DB_CLUSTER_ENDPOINT: "host",
        ANALYST_DB_PORT: "not-a-number",
      }),
    ).toEqual({
      host: "host",
      port: 5432,
      database: "thinkwork",
      user: "analyst_reader",
      region: "us-east-1",
    });
  });
});
