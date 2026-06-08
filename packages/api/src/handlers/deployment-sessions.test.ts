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
          orderBy: vi.fn(async () => selectQueue.shift() ?? []),
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

  it("starts teardown through the deployment runner when configured", async () => {
    vi.stubEnv(
      "THINKWORK_DEPLOYMENT_STATE_MACHINE_ARN",
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-deployment-orchestrator",
    );
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
        action: "teardown",
        sessionId: SESSION_ID,
        awsAccountId: "123456789012",
      }),
    );
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
        sessionId: SESSION_ID,
        awsAccountId: "123456789012",
        awsRegion: "us-east-1",
        evidenceBucket: "thinkwork-evidence",
      }),
    );
    expect(payload.firstAdmin).toEqual({
      name: "Eric Odom",
      email: "eric@example.com",
    });
    expect(JSON.stringify(command.input)).not.toContain("password");
    expect(JSON.parse(response.body || "{}").session.status).toBe("deploying");
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

function sessionRow() {
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
    credentials_status: "not_connected",
    runner_mode: "hosted",
    terraform_backend: {},
    session_config: {},
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
  };
}
