import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue, returningQueue, insertCalls, updateCalls, mockDb } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const returningQueue: unknown[][] = [];
    const insertCalls: Array<Record<string, unknown>> = [];
    const updateCalls: Array<Record<string, unknown>> = [];
    const mockDb = {
      select: vi.fn(() => {
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => selectQueue.shift() ?? []),
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => selectQueue.shift() ?? []),
            then: (resolve: (value: unknown[]) => void) =>
              resolve(selectQueue.shift() ?? []),
          })),
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return {
            returning: async () => returningQueue.shift() ?? [],
            onConflictDoNothing: async () => [],
            then: (resolve: (value: unknown[]) => void) => resolve([]),
          };
        },
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return {
            where: () => ({
              returning: async () => returningQueue.shift() ?? [],
            }),
          };
        },
      })),
    };
    return {
      selectQueue,
      returningQueue,
      insertCalls,
      updateCalls,
      mockDb,
    };
  });

const { mockSfnSend } = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
}));

const { mockSecretsSend } = vi.hoisted(() => ({
  mockSecretsSend: vi.fn(),
}));

const { mockS3Send } = vi.hoisted(() => ({
  mockS3Send: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({
  db: mockDb,
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  StartExecutionCommand: class StartExecutionCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockS3Send;
  },
  GetObjectCommand: class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mockSecretsSend;
  },
  CreateSecretCommand: class CreateSecretCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteSecretCommand: class DeleteSecretCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

let mod: typeof import("./deployment-sessions.js");
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  selectQueue.length = 0;
  returningQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  mockSfnSend.mockReset();
  mockSecretsSend.mockReset();
  mockS3Send.mockReset();
  mod = await import("./deployment-sessions.js");
});

describe("deployment session handler", () => {
  it("creates a control-plane session without storing admin passwords", async () => {
    returningQueue.push([
      {
        id: SESSION_ID,
        status: "ready_for_credentials",
        current_step_key: "connect_aws",
        requested_action: "deploy",
        source: "local_dev",
        customer_name: "TEI",
        environment_name: "tei-e2e",
        aws_account_id: "123456789012",
        aws_region: "us-east-1",
        availability_zones: ["us-east-1a", "us-east-1b"],
        admin_name: "Eric Odom",
        admin_email: "eric@example.com",
        credentials_status: "not_connected",
        runner_mode: "hosted",
        terraform_backend: {},
        session_config: {},
        created_at: "2026-06-08T00:00:00.000Z",
        updated_at: "2026-06-08T00:00:00.000Z",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "session_created" }]);

    const response = await mod.handler(
      event("POST", "/api/deployment-sessions", {
        customerName: "TEI",
        environmentName: "tei-e2e",
        awsAccountId: "123456789012",
        awsRegion: "us-east-1",
        availabilityZones: ["us-east-1a", "us-east-1b"],
        adminName: "Eric Odom",
        adminEmail: "eric@example.com",
        adminPassword: "do-not-store",
        source: "local_dev",
      }),
    );

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body || "{}");
    expect(body.clientToken).toEqual(expect.any(String));
    expect(insertCalls[0]).toEqual(
      expect.objectContaining({
        customer_name: "TEI",
        environment_name: "tei-e2e",
        aws_account_id: "123456789012",
        aws_region: "us-east-1",
        credentials_status: "not_connected",
      }),
    );
    expect(JSON.stringify(insertCalls)).not.toContain("do-not-store");
    expect(JSON.stringify(insertCalls)).toContain("passwordPersisted");
    expect(response.headers?.["Access-Control-Allow-Headers"]).toContain(
      "x-thinkwork-deployment-token",
    );
  });

  it("rejects resume without the deployment session token", async () => {
    selectQueue.push([
      {
        id: SESSION_ID,
        client_token_hash: hash("correct-token"),
      },
    ]);

    const response = await mod.handler(
      event("GET", `/api/deployment-sessions/${SESSION_ID}`, undefined, {
        "x-thinkwork-deployment-token": "wrong-token",
      }),
    );

    expect(response.statusCode).toBe(403);
  });

  it("records teardown as a resumable requested action", async () => {
    const session = {
      id: SESSION_ID,
      client_token_hash: hash("correct-token"),
      status: "ready_for_credentials",
      current_step_key: "connect_aws",
      requested_action: "deploy",
      source: "browser",
      customer_name: "TEI",
      environment_name: "tei-e2e",
      aws_account_id: "123456789012",
      aws_region: "us-east-1",
      availability_zones: ["us-east-1a", "us-east-1b"],
      admin_name: "Eric Odom",
      admin_email: "eric@example.com",
      credentials_status: "not_connected",
      runner_mode: "hosted",
      terraform_backend: {},
      session_config: {},
      created_at: "2026-06-08T00:00:00.000Z",
      updated_at: "2026-06-08T00:00:00.000Z",
    };
    selectQueue.push([session]);
    returningQueue.push([
      {
        ...session,
        status: "teardown_requested",
        current_step_key: "teardown",
        requested_action: "teardown",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "teardown_requested" }]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/teardown`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requested_action: "teardown",
          status: "teardown_requested",
          current_step_key: "teardown",
        }),
      ]),
    );
    expect(JSON.parse(response.body || "{}").session.status).toBe(
      "teardown_requested",
    );
  });

  it("validates a bootstrap credential lease without storing AWS secret values in session rows or events", async () => {
    mockSecretsSend.mockResolvedValue({
      ARN: "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/deployment-bootstrap-leases/session/lease",
    });
    const session = sessionRow({ credentials_status: "not_connected" });
    selectQueue.push([session]);
    returningQueue.push([
      {
        ...session,
        status: "ready_to_deploy",
        current_step_key: "foundation",
        credentials_status: "validated",
      },
    ]);
    selectQueue.push([
      { id: "event-1", event_type: "bootstrap_credential_lease_validated" },
    ]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/bootstrap-credential-lease`,
        {
          kind: "temporary_credentials",
          accessKeyId: "ASIA1234567890123456",
          secretAccessKey: "super-secret-access-key-value",
          sessionToken: "temporary-session-token-value",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mockSecretsSend).toHaveBeenCalledTimes(1);
    const command = mockSecretsSend.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(String(command.input.Name)).toContain(
      "thinkwork/dev/deployment-bootstrap-leases",
    );
    expect(String(command.input.SecretString)).toContain(
      "super-secret-access-key-value",
    );
    const persistedDbAndEvents = JSON.stringify({ insertCalls, updateCalls });
    expect(persistedDbAndEvents).not.toContain("super-secret-access-key-value");
    expect(persistedDbAndEvents).not.toContain("temporary-session-token-value");
    expect(persistedDbAndEvents).toContain("secret_fingerprint");
    expect(JSON.parse(response.body || "{}").session.credentialsStatus).toBe(
      "validated",
    );
  });

  it("rejects expired bootstrap credentials before writing a vault secret", async () => {
    const session = sessionRow({ credentials_status: "not_connected" });
    selectQueue.push([session]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/bootstrap-credential-lease`,
        {
          kind: "temporary_credentials",
          accessKeyId: "ASIA1234567890123456",
          secretAccessKey: "super-secret-access-key-value",
          sessionToken: "temporary-session-token-value",
          expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
        },
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(mockSecretsSend).not.toHaveBeenCalled();
    expect(JSON.stringify(insertCalls)).not.toContain(
      "super-secret-access-key-value",
    );
  });

  it("revokes a bootstrap credential lease by deleting the vault secret", async () => {
    mockSecretsSend.mockResolvedValue({});
    const session = sessionRow({ credentials_status: "validated" });
    selectQueue.push([session]);
    selectQueue.push([
      {
        id: "lease-1",
        session_id: SESSION_ID,
        status: "validated",
        secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/deployment-bootstrap-leases/session/lease",
        secret_fingerprint: "abc123",
        created_at: "2026-06-09T00:00:00.000Z",
      },
    ]);
    returningQueue.push([
      {
        ...session,
        credentials_status: "revoked",
        current_step_key: "connect_aws",
      },
    ]);
    selectQueue.push([
      { id: "event-1", event_type: "bootstrap_credential_lease_revoked" },
    ]);

    const response = await mod.handler(
      event(
        "DELETE",
        `/api/deployment-sessions/${SESSION_ID}/bootstrap-credential-lease`,
        undefined,
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    const command = mockSecretsSend.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(command.input).toEqual(
      expect.objectContaining({
        SecretId: expect.stringContaining("deployment-bootstrap-leases"),
        ForceDeleteWithoutRecovery: true,
      }),
    );
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "revoked",
        }),
      ]),
    );
  });

  it("marks authority transferred only after profile proof and lease deletion", async () => {
    mockSecretsSend.mockResolvedValue({});
    const session = sessionRow({
      credentials_status: "validated",
      session_config: {
        bootstrapCredentialLease: {
          id: "lease-1",
          status: "validated",
        },
      },
    });
    selectQueue.push([session]);
    selectQueue.push([
      {
        id: "lease-1",
        session_id: SESSION_ID,
        status: "validated",
        secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/deployment-bootstrap-leases/session/lease",
        secret_fingerprint: "abc123",
      },
    ]);
    returningQueue.push([
      {
        ...session,
        status: "authority_transferred",
        current_step_key: "first_admin",
        credentials_status: "transferred",
        runner_mode: "customer_controller",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "authority_transferred" }]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/authority-transfer`,
        authorityTransferBody(),
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    const deleteCommand = mockSecretsSend.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(deleteCommand.input).toEqual(
      expect.objectContaining({
        ForceDeleteWithoutRecovery: true,
      }),
    );
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "transferred",
          revoked_at: expect.any(Date),
        }),
        expect.objectContaining({
          status: "authority_transferred",
          credentials_status: "transferred",
          runner_mode: "customer_controller",
        }),
      ]),
    );
    expect(JSON.stringify(updateCalls)).not.toContain(
      "super-secret-access-key-value",
    );
  });

  it("rejects authority transfer without readable controller and profile proof", async () => {
    const session = sessionRow({ credentials_status: "validated" });
    selectQueue.push([session]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/authority-transfer`,
        { profile: {}, controller: {} },
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(400);
    expect(mockSecretsSend).not.toHaveBeenCalled();
  });

  it("requires a validated bootstrap credential lease before deployment start", async () => {
    const session = sessionRow({ credentials_status: "not_connected" });
    selectQueue.push([session]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/start`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(409);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("starts teardown through the deployment runner when configured", async () => {
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
    );
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.134");
    vi.stubEnv(
      "THINKWORK_RELEASE_MANIFEST_URL",
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
    );
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", "a".repeat(64));
    mockSfnSend.mockResolvedValue({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment-orchestrator:tw-teardown",
    });
    const session = sessionRow();
    selectQueue.push([session]);
    returningQueue.push([
      {
        ...session,
        status: "teardown_requested",
        current_step_key: "teardown",
        requested_action: "teardown",
      },
    ]);
    returningQueue.push([
      {
        ...session,
        status: "destroying",
        current_step_key: "teardown",
        requested_action: "teardown",
        runner_mode: "step_functions",
      },
    ]);
    selectQueue.push([
      { id: "event-1", event_type: "teardown_execution_started" },
    ]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/teardown`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const command = mockSfnSend.mock.calls[0]?.[0] as {
      input: { input: string; stateMachineArn: string; name: string };
    };
    expect(command.input.name).toMatch(/^tw-teardown-/);
    const payload = JSON.parse(command.input.input);
    expect(payload).toEqual(
      expect.objectContaining({
        phase: "teardown",
        action: "destroy",
        contract: "thinkwork.deployment.controller.v1",
        schemaVersion: 1,
        sessionId: SESSION_ID,
        awsAccountId: "123456789012",
        releaseVersion: "v0.1.0-canary.134",
        terraformModuleVersion: "0.1.0-canary.134",
      }),
    );
    expect(payload.release).toEqual({
      version: "v0.1.0-canary.134",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
      manifestSha256: "a".repeat(64),
    });
    expect(payload.evidence).toEqual(
      expect.objectContaining({
        bucket: null,
        prefix: `sessions/${SESSION_ID}/destroy`,
        expectedArtifacts: expect.arrayContaining([
          "controller-input-summary.json",
          "redacted-terraform-vars.json",
          "terraform-plan.json",
          "deployment-evidence.json",
        ]),
      }),
    );
    expect(payload.features.baseInstall).toEqual({
      cognee: false,
      slack: false,
      stripe: false,
      twenty: false,
    });
    expect(JSON.stringify(command.input)).not.toContain("password");
    expect(JSON.parse(response.body || "{}").session.status).toBe("destroying");
  });

  it("records a resumable start event when the deployment runner is not configured", async () => {
    const session = sessionRow();
    selectQueue.push([session]);
    returningQueue.push([
      {
        ...session,
        status: "runner_not_configured",
        current_step_key: "foundation",
        runner_mode: "step_functions",
      },
    ]);
    selectQueue.push([{ id: "event-1", event_type: "runner_not_configured" }]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/start`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "runner_not_configured",
          current_step_key: "foundation",
          runner_mode: "step_functions",
        }),
      ]),
    );
    expect(JSON.parse(response.body || "{}").session.status).toBe(
      "runner_not_configured",
    );
  });

  it("starts the standard deployment runbook without sending secrets", async () => {
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
    );
    vi.stubEnv("THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET", "thinkwork-evidence");
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.134");
    vi.stubEnv(
      "THINKWORK_RELEASE_MANIFEST_URL",
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
    );
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", "b".repeat(64));
    mockSfnSend.mockResolvedValue({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-deployment-orchestrator:tw-session",
    });
    const session = sessionRow();
    selectQueue.push([session]);
    returningQueue.push([
      {
        ...session,
        status: "deploying",
        current_step_key: "foundation",
        runner_mode: "step_functions",
        session_config: {
          deploymentRun: {
            executionArn: "arn:execution",
          },
        },
      },
    ]);
    selectQueue.push([
      { id: "event-1", event_type: "deployment_execution_started" },
    ]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/start`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const command = mockSfnSend.mock.calls[0]?.[0] as {
      input: { input: string; stateMachineArn: string; name: string };
    };
    expect(command.input.stateMachineArn).toContain(
      "thinkwork-dev-deployment-orchestrator",
    );
    expect(command.input.name).toMatch(/^tw-session-/);
    const payload = JSON.parse(command.input.input);
    expect(payload).toEqual(
      expect.objectContaining({
        phase: "deploy",
        action: "deploy",
        contract: "thinkwork.deployment.controller.v1",
        schemaVersion: 1,
        sessionId: SESSION_ID,
        awsAccountId: "123456789012",
        awsRegion: "us-east-1",
        evidenceBucket: "thinkwork-evidence",
        releaseVersion: "v0.1.0-canary.134",
        terraformModuleVersion: "0.1.0-canary.134",
      }),
    );
    expect(payload.release).toEqual({
      version: "v0.1.0-canary.134",
      manifestUrl:
        "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
      manifestSha256: "b".repeat(64),
    });
    expect(payload.evidence).toEqual(
      expect.objectContaining({
        bucket: "thinkwork-evidence",
        prefix: `sessions/${SESSION_ID}/deploy`,
        expectedArtifacts: expect.arrayContaining([
          "controller-input-summary.json",
          "redacted-terraform-vars.json",
          "terraform-plan.json",
          "terraform-outputs.json",
          "deployment-evidence.json",
        ]),
      }),
    );
    expect(payload.features.baseInstall).toEqual({
      cognee: false,
      slack: false,
      stripe: false,
      twenty: false,
    });
    expect(payload.firstAdmin).toEqual({
      name: "Eric Odom",
      email: "eric@example.com",
    });
    expect(JSON.stringify(command.input)).not.toContain("password");
    expect(JSON.parse(response.body || "{}").session.status).toBe("deploying");
  });

  it("starts teardown through the customer controller after authority transfer", async () => {
    mockSfnSend.mockResolvedValue({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-tei-e2e-deployment-orchestrator:tw-teardown",
    });
    const session = sessionRow({
      status: "authority_transferred",
      credentials_status: "transferred",
      runner_mode: "customer_controller",
      session_config: {
        authorityTransfer: {
          controller: {
            stateMachineArn:
              "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
          },
        },
      },
    });
    selectQueue.push([session]);
    returningQueue.push([
      {
        ...session,
        status: "teardown_requested",
        current_step_key: "teardown",
        requested_action: "teardown",
      },
    ]);
    returningQueue.push([
      {
        ...session,
        status: "destroying",
        current_step_key: "teardown",
        requested_action: "teardown",
        runner_mode: "customer_controller",
      },
    ]);
    selectQueue.push([
      { id: "event-1", event_type: "teardown_execution_started" },
    ]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/teardown`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    const command = mockSfnSend.mock.calls[0]?.[0] as {
      input: { input: string; stateMachineArn: string; name: string };
    };
    expect(command.input.stateMachineArn).toContain("thinkwork-tei-e2e");
  });

  it("threads customer domain fields from session_config into the controller input", async () => {
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
    );
    vi.stubEnv("THINKWORK_DEPLOYMENT_EVIDENCE_BUCKET", "thinkwork-evidence");
    vi.stubEnv("THINKWORK_RELEASE_VERSION", "v0.1.0-canary.134");
    vi.stubEnv(
      "THINKWORK_RELEASE_MANIFEST_URL",
      "https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.134/thinkwork-release.json",
    );
    vi.stubEnv("THINKWORK_RELEASE_MANIFEST_SHA256", "b".repeat(64));
    mockSfnSend.mockResolvedValue({ executionArn: "arn:execution" });
    const session = sessionRow({
      session_config: {
        customerDomain: "tei.thinkwork.ai",
        customerDomainDelegated: true,
        customerDomainLegacyRetired: false,
      },
    });
    selectQueue.push([session]);
    returningQueue.push([{ ...session, status: "deploying" }]);
    selectQueue.push([
      { id: "event-1", event_type: "deployment_execution_started" },
    ]);

    const response = await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/start`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    expect(response.statusCode).toBe(200);
    const command = mockSfnSend.mock.calls[0]?.[0] as {
      input: { input: string };
    };
    const payload = JSON.parse(command.input.input);
    expect(payload.customerDomain).toBe("tei.thinkwork.ai");
    expect(payload.customerDomainDelegated).toBe(true);
    expect(payload.customerDomainLegacyRetired).toBe(false);
  });

  it("sends empty customer domain defaults when the session has none configured", async () => {
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
    );
    mockSfnSend.mockResolvedValue({ executionArn: "arn:execution" });
    const session = sessionRow();
    selectQueue.push([session]);
    returningQueue.push([{ ...session, status: "deploying" }]);
    selectQueue.push([
      { id: "event-1", event_type: "deployment_execution_started" },
    ]);

    await mod.handler(
      event(
        "POST",
        `/api/deployment-sessions/${SESSION_ID}/start`,
        {},
        { "x-thinkwork-deployment-token": "correct-token" },
      ),
    );

    const command = mockSfnSend.mock.calls[0]?.[0] as {
      input: { input: string };
    };
    const payload = JSON.parse(command.input.input);
    expect(payload.customerDomain).toBe("");
    expect(payload.customerDomainDelegated).toBe(false);
    expect(payload.customerDomainLegacyRetired).toBe(false);
  });

  it("fails a domain-requesting run when evidence lacks the echoed domain fields", async () => {
    const session = domainDeployingSessionRow();
    selectQueue.push([session]);
    // Old-runner evidence: no consumedDomainFields key at all.
    mockS3Send.mockResolvedValue(
      evidenceObject({ status: "running", sessionId: SESSION_ID }),
    );
    returningQueue.push([
      {
        ...session,
        status: "failed",
        error_message: "runner version skew",
      },
    ]);
    selectQueue.push([
      { id: "event-1", event_type: "domain_fields_echo_missing" },
    ]);

    const response = await mod.handler(
      event("GET", `/api/deployment-sessions/${SESSION_ID}`, undefined, {
        "x-thinkwork-deployment-token": "correct-token",
      }),
    );

    expect(response.statusCode).toBe(200);
    const getCommand = mockS3Send.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(getCommand.input).toEqual({
      Bucket: "thinkwork-evidence",
      Key: `sessions/${SESSION_ID}/deploy/deployment-evidence.json`,
    });
    expect(updateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          error_message: expect.stringContaining("runner version skew"),
        }),
      ]),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "domain_fields_echo_missing",
        }),
      ]),
    );
    expect(JSON.parse(response.body || "{}").session.status).toBe("failed");
  });

  it("records the echo verification when evidence carries the consumed domain fields", async () => {
    const session = domainDeployingSessionRow();
    selectQueue.push([session]);
    mockS3Send.mockResolvedValue(
      evidenceObject({
        status: "running",
        sessionId: SESSION_ID,
        consumedDomainFields: {
          customerDomain: "tei.thinkwork.ai",
          customerDomainDelegated: true,
          customerDomainLegacyRetired: false,
        },
      }),
    );
    returningQueue.push([session]);
    selectQueue.push([{ id: "event-1", event_type: "domain_fields_echoed" }]);

    const response = await mod.handler(
      event("GET", `/api/deployment-sessions/${SESSION_ID}`, undefined, {
        "x-thinkwork-deployment-token": "correct-token",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(updateCalls).toEqual([
      expect.objectContaining({
        session_config: expect.objectContaining({
          domainFieldsEcho: expect.objectContaining({
            verifiedAt: expect.any(String),
            consumedDomainFields: expect.objectContaining({
              customerDomain: "tei.thinkwork.ai",
              customerDomainDelegated: true,
              customerDomainLegacyRetired: false,
            }),
          }),
        }),
      }),
    ]);
    expect(updateCalls).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "failed" })]),
    );
    expect(insertCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "domain_fields_echoed" }),
      ]),
    );
  });

  it("leaves a domain-requesting run untouched while evidence is not written yet", async () => {
    const session = domainDeployingSessionRow();
    selectQueue.push([session]);
    mockS3Send.mockRejectedValue(new Error("NoSuchKey"));
    selectQueue.push([]);

    const response = await mod.handler(
      event("GET", `/api/deployment-sessions/${SESSION_ID}`, undefined, {
        "x-thinkwork-deployment-token": "correct-token",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(updateCalls).toEqual([]);
    expect(JSON.parse(response.body || "{}").session.status).toBe("deploying");
  });

  it("skips the echo guard when the session requested no customer domain", async () => {
    const session = sessionRow({
      status: "deploying",
      session_config: {
        deploymentRun: {
          executionArn: "arn:execution",
          evidenceBucket: "thinkwork-evidence",
          evidencePrefix: `sessions/${SESSION_ID}/deploy`,
        },
      },
    });
    selectQueue.push([session]);
    selectQueue.push([]);

    const response = await mod.handler(
      event("GET", `/api/deployment-sessions/${SESSION_ID}`, undefined, {
        "x-thinkwork-deployment-token": "correct-token",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(updateCalls).toEqual([]);
  });
});

function event(
  method: string,
  rawPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): any {
  return {
    rawPath,
    headers,
    requestContext: {
      http: { method },
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    client_token_hash: hash("correct-token"),
    status: "ready_for_credentials",
    current_step_key: "connect_aws",
    requested_action: "deploy",
    source: "browser",
    customer_name: "TEI",
    environment_name: "tei-e2e",
    aws_account_id: "123456789012",
    aws_region: "us-east-1",
    availability_zones: ["us-east-1a", "us-east-1b"],
    admin_name: "Eric Odom",
    admin_email: "eric@example.com",
    credentials_status: "validated",
    runner_mode: "hosted",
    terraform_backend: {},
    session_config: {},
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
    ...overrides,
  };
}

function domainDeployingSessionRow() {
  return sessionRow({
    status: "deploying",
    session_config: {
      customerDomain: "tei.thinkwork.ai",
      customerDomainDelegated: true,
      customerDomainLegacyRetired: false,
      deploymentRun: {
        executionArn: "arn:execution",
        evidenceBucket: "thinkwork-evidence",
        evidencePrefix: `sessions/${SESSION_ID}/deploy`,
      },
    },
  });
}

function evidenceObject(evidence: Record<string, unknown>) {
  return {
    Body: {
      transformToString: async () => JSON.stringify(evidence),
    },
  };
}

function authorityTransferBody() {
  return {
    profile: {
      stage: "tei-e2e",
      region: "us-east-1",
      accountId: "123456789012",
      releaseVersion: "v0.1.0-canary.134",
      releaseManifestUrl: "https://example.com/thinkwork-release.json",
      releaseManifestSha256: "a".repeat(64),
      apiEndpoint: "https://api.example.com",
      graphqlHttpUrl: "https://api.example.com/graphql",
      appsyncUrl: "https://appsync.example.com/graphql",
      appsyncRealtimeUrl: "wss://appsync.example.com/graphql",
      cognitoUserPoolId: "us-east-1_abc",
      cognitoClientId: "client-id",
      controller: {
        stateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
        stateMachineName: "thinkwork-tei-e2e-deployment-orchestrator",
      },
    },
    controller: {
      stateMachineArn:
        "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-tei-e2e-deployment-orchestrator",
      stateMachineName: "thinkwork-tei-e2e-deployment-orchestrator",
    },
    release: {
      version: "v0.1.0-canary.134",
      manifestUrl: "https://example.com/thinkwork-release.json",
      manifestSha256: "a".repeat(64),
    },
  };
}
