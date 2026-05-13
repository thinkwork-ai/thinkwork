/**
 * Unit tests for the computer-terminal-start REST handler. Mocks
 * Cognito auth, the DB queue (workspace-files-handler style), and the
 * ECS client; verifies the auth gate, the tenant-admin gate, the
 * task-resolution path, and the ExecuteCommand call shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DescribeTasksCommand,
  ECSClient,
  ExecuteCommandCommand,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";

const { dbQueue, pushDbRows, resetDbQueue } = vi.hoisted(() => {
  const queue: unknown[][] = [];
  return {
    dbQueue: queue,
    pushDbRows: (rows: unknown[]) => queue.push(rows),
    resetDbQueue: () => {
      queue.length = 0;
    },
  };
});

vi.mock("../graphql/utils.js", () => {
  const tableCol = (label: string) => ({ __col: label });
  const chain = () => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
        fn.then = (
          onFulfilled: (v: unknown) => unknown,
          onRejected: (e: unknown) => unknown,
        ) =>
          Promise.resolve(dbQueue.shift() ?? []).then(onFulfilled, onRejected);
        fn.limit = vi
          .fn()
          .mockImplementation(() => Promise.resolve(dbQueue.shift() ?? []));
        return fn;
      }),
    })),
  });
  return {
    db: { select: vi.fn().mockImplementation(() => chain()) },
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...args: unknown[]) => ({ __and: args }),
    computers: {
      id: tableCol("computers.id"),
      tenant_id: tableCol("computers.tenant_id"),
      ecs_service_name: tableCol("computers.ecs_service_name"),
    },
    tenantMembers: {
      tenant_id: tableCol("tenant_members.tenant_id"),
      principal_id: tableCol("tenant_members.principal_id"),
      role: tableCol("tenant_members.role"),
    },
  };
});

const { authMockImpl } = vi.hoisted(() => ({ authMockImpl: vi.fn() }));
vi.mock("../lib/cognito-auth.js", () => ({ authenticate: authMockImpl }));

const { resolveCallerMockImpl } = vi.hoisted(() => ({
  resolveCallerMockImpl: vi.fn(),
}));
vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: resolveCallerMockImpl,
}));

const ecsMock = mockClient(ECSClient);

process.env.COMPUTER_RUNTIME_CLUSTER_NAME = "thinkwork-test-computer";

import { handler } from "../handlers/computer-terminal-start.js";

const TENANT = "tenant-a";
const USER = "user-eric";
const COMPUTER_ID = "computer-marco";
const TASK_ARN =
  "arn:aws:ecs:us-east-1:000000000000:task/thinkwork-test-computer/abc123";
const SERVICE = "thinkwork-test-computer-marco";

function event(
  body: Record<string, unknown> = {},
  pathParams: Record<string, string> = { computerId: COMPUTER_ID },
  authed = true,
): any {
  return {
    headers: authed
      ? { authorization: "Bearer fake-jwt", "content-type": "application/json" }
      : { "content-type": "application/json" },
    pathParameters: pathParams,
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify(body),
  };
}

function authOkResult() {
  return { authType: "cognito" as const, principalId: USER };
}

function parse(res: any) {
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
  ecsMock.reset();
  resetDbQueue();
  authMockImpl.mockReset();
  resolveCallerMockImpl.mockReset();
});

describe("computer-terminal-start", () => {
  it("returns 401 when authenticate fails", async () => {
    authMockImpl.mockResolvedValue(null);
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when caller's tenant cannot be resolved", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: null });
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when computerId path param is missing", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    const res = parse(await handler(event({}, {} as Record<string, string>)));
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when the computer is not in the caller's tenant", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([]); // computer lookup empty
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when caller is not a tenant admin", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    pushDbRows([{ role: "member" }]);
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when caller uses apikey auth (cognito-only)", async () => {
    authMockImpl.mockResolvedValue({
      authType: "apikey" as const,
      principalId: "svc",
    });
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when no task is currently running", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    pushDbRows([{ role: "admin" }]);
    ecsMock.on(ListTasksCommand).resolves({ taskArns: [] });
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(409);
  });

  it("returns 409 when the ECS Exec agent is not yet RUNNING", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    pushDbRows([{ role: "admin" }]);
    ecsMock.on(ListTasksCommand).resolves({ taskArns: [TASK_ARN] });
    ecsMock.on(DescribeTasksCommand).resolves({
      tasks: [
        {
          taskArn: TASK_ARN,
          containers: [
            {
              name: "computer-runtime",
              managedAgents: [
                { name: "ExecuteCommandAgent", lastStatus: "PENDING" },
              ],
            },
          ],
        },
      ],
    });
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain("PENDING");
  });

  it("returns the session envelope on the happy path", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    pushDbRows([{ role: "admin" }]);
    ecsMock.on(ListTasksCommand).resolves({ taskArns: [TASK_ARN] });
    ecsMock.on(DescribeTasksCommand).resolves({
      tasks: [
        {
          taskArn: TASK_ARN,
          containers: [
            {
              name: "computer-runtime",
              managedAgents: [
                { name: "ExecuteCommandAgent", lastStatus: "RUNNING" },
              ],
            },
          ],
        },
      ],
    });
    ecsMock.on(ExecuteCommandCommand).resolves({
      session: {
        sessionId: "sess-1",
        streamUrl: "wss://ssmmessages.us-east-1.amazonaws.com/...",
        tokenValue: "token-xyz",
      },
    });

    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      sessionId: "sess-1",
      streamUrl: expect.stringContaining("wss://"),
      tokenValue: "token-xyz",
      container: "computer-runtime",
      taskArn: TASK_ARN,
      idleTimeoutSec: 1200,
    });
    const execCall = ecsMock.commandCalls(ExecuteCommandCommand)[0];
    expect(execCall.args[0].input).toMatchObject({
      cluster: "thinkwork-test-computer",
      task: TASK_ARN,
      container: "computer-runtime",
      interactive: true,
      command: "/bin/sh",
    });
  });

  it("accepts an override command from the request body", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    pushDbRows([{ role: "owner" }]);
    ecsMock.on(ListTasksCommand).resolves({ taskArns: [TASK_ARN] });
    ecsMock.on(DescribeTasksCommand).resolves({
      tasks: [
        {
          taskArn: TASK_ARN,
          containers: [
            {
              name: "computer-runtime",
              managedAgents: [
                { name: "ExecuteCommandAgent", lastStatus: "RUNNING" },
              ],
            },
          ],
        },
      ],
    });
    ecsMock.on(ExecuteCommandCommand).resolves({
      session: {
        sessionId: "sess-2",
        streamUrl: "wss://ssmmessages.us-east-1.amazonaws.com/...",
        tokenValue: "token-2",
      },
    });

    const res = parse(await handler(event({ command: "/bin/bash" })));
    expect(res.statusCode).toBe(200);
    const execCall = ecsMock.commandCalls(ExecuteCommandCommand)[0];
    expect(execCall.args[0].input.command).toBe("/bin/bash");
  });

  it("returns 502 when ExecuteCommand throws", async () => {
    authMockImpl.mockResolvedValue(authOkResult());
    resolveCallerMockImpl.mockResolvedValue({ userId: USER, tenantId: TENANT });
    pushDbRows([
      { id: COMPUTER_ID, tenant_id: TENANT, ecs_service_name: SERVICE },
    ]);
    pushDbRows([{ role: "admin" }]);
    ecsMock.on(ListTasksCommand).resolves({ taskArns: [TASK_ARN] });
    ecsMock.on(DescribeTasksCommand).resolves({
      tasks: [
        {
          taskArn: TASK_ARN,
          containers: [
            {
              name: "computer-runtime",
              managedAgents: [
                { name: "ExecuteCommandAgent", lastStatus: "RUNNING" },
              ],
            },
          ],
        },
      ],
    });
    ecsMock.on(ExecuteCommandCommand).rejects(new Error("TargetNotConnected"));
    const res = parse(await handler(event()));
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("TargetNotConnected");
  });

  it("short-circuits CORS preflight with 204", async () => {
    const preflight = await handler({
      ...event(),
      requestContext: { http: { method: "OPTIONS" } },
    } as any);
    expect(preflight.statusCode).toBe(204);
  });
});
