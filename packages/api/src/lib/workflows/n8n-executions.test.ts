import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverN8nExecutions } from "./n8n-executions.js";

type Rows = Record<string, unknown>[];

const selectQueue: Rows[] = [];

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  selectQueue.length = 0;
});

describe("n8n execution discovery", () => {
  it("pulls execution rows through the tenant n8n public API credential", async () => {
    selectQueue.push(
      [{ id: "install-n8n", state: "installed" }],
      [
        {
          id: "app-n8n",
          desired_status: "enabled",
          current_status: "running",
          desired_config: {
            publicUrl: "https://n8n.example.test",
            serviceCredentialSecretArn: "arn:secret:n8n-service",
          },
        },
      ],
      [
        {
          id: "credential-n8n-api",
          secret_ref: "secret:n8n-api",
          metadata_json: { n8nBaseUrl: "https://n8n.example.test" },
        },
      ],
    );
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://n8n.example.test/api/v1/executions?limit=50&includeData=false",
      );
      expect(init?.headers).toMatchObject({
        "X-N8N-API-KEY": "n8n_test_key",
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "exec-1",
              workflowId: "wf-1",
              workflowData: { id: "wf-1", name: "Fulfillment follow-up" },
              status: "success",
              mode: "webhook",
              startedAt: "2026-06-20T12:00:00.000Z",
              stoppedAt: "2026-06-20T12:00:03.500Z",
              data: { secret: "must not be returned" },
            },
            {
              id: "exec-2",
              workflowId: "wf-2",
              workflowData: { id: "wf-2", name: "Broken workflow" },
              finished: true,
              error: { message: "HTTP node failed" },
              startedAt: "2026-06-20T12:01:00.000Z",
              stoppedAt: "2026-06-20T12:01:01.000Z",
            },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      );
    });

    const result = await discoverN8nExecutions(
      fakeDb(),
      {
        tenantId: "tenant-1",
        installId: "install-n8n",
      },
      {
        fetch: fetchImpl as typeof fetch,
        readTenantCredentialSecret: vi.fn(async () => ({
          apiKey: "n8n_test_key",
        })),
      },
    );

    expect(result.readinessState).toBe("ready");
    expect(result.nativeBaseUrl).toBe("https://n8n.example.test/");
    expect(result.executions).toEqual([
      expect.objectContaining({
        externalExecutionId: "exec-1",
        externalWorkflowId: "wf-1",
        workflowName: "Fulfillment follow-up",
        status: "success",
        durationMs: 3500,
        failureMessage: null,
        nativeWorkflowUrl: "https://n8n.example.test/workflow/wf-1",
        nativeExecutionUrl:
          "https://n8n.example.test/workflow/wf-1/executions/exec-1",
      }),
      expect.objectContaining({
        externalExecutionId: "exec-2",
        externalWorkflowId: "wf-2",
        status: "error",
        failureMessage: "HTTP node failed",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("must not be returned");
  });

  it("blocks clearly when the n8n API credential is missing", async () => {
    selectQueue.push(
      [{ id: "install-n8n", state: "installed" }],
      [
        {
          id: "app-n8n",
          desired_status: "enabled",
          current_status: "running",
          desired_config: {
            publicUrl: "https://n8n.example.test",
            serviceCredentialSecretArn: "arn:secret:n8n-service",
          },
        },
      ],
      [],
    );

    const result = await discoverN8nExecutions(fakeDb(), {
      tenantId: "tenant-1",
      installId: "install-n8n",
    });

    expect(result.readinessState).toBe("blocked_not_ready");
    expect(result.readinessReasons).toEqual([
      expect.objectContaining({ code: "n8n_api_key_missing" }),
    ]);
    expect(result.executions).toEqual([]);
  });

  it("returns bounded readiness errors instead of raw failed API payloads", async () => {
    selectQueue.push(
      [{ id: "install-n8n", state: "installed" }],
      [
        {
          id: "app-n8n",
          desired_status: "enabled",
          current_status: "running",
          desired_config: {
            publicUrl: "https://n8n.example.test",
            serviceCredentialSecretArn: "arn:secret:n8n-service",
          },
        },
      ],
      [
        {
          id: "credential-n8n-api",
          secret_ref: "secret:n8n-api",
          metadata_json: { n8nBaseUrl: "https://n8n.example.test" },
        },
      ],
    );
    const fetchImpl = vi.fn(async () => {
      return new Response("upstream secret body".repeat(40), { status: 502 });
    });

    const result = await discoverN8nExecutions(
      fakeDb(),
      {
        tenantId: "tenant-1",
        installId: "install-n8n",
      },
      {
        fetch: fetchImpl as typeof fetch,
        readTenantCredentialSecret: vi.fn(async () => ({
          apiKey: "n8n_test_key",
        })),
      },
    );

    expect(result.readinessState).toBe("blocked_not_ready");
    expect(result.readinessReasons).toEqual([
      expect.objectContaining({ code: "n8n_api_executions_failed" }),
    ]);
    expect(JSON.stringify(result.readinessReasons).length).toBeLessThan(500);
    expect(JSON.stringify(result.readinessReasons)).not.toContain(
      "upstream secret body",
    );
    expect(result.executions).toEqual([]);
  });
});
