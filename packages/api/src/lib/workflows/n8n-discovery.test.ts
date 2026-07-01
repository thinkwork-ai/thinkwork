import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectN8nWorkflow,
  disconnectN8nWorkflow,
  discoverN8nWorkflows,
  n8nWorkflowSlug,
} from "./n8n-discovery.js";

type Rows = Record<string, unknown>[];

const selectQueue: Rows[] = [];
const insertRows = vi.fn<() => Rows>();
const insertValues = vi.fn();
const updateValues = vi.fn();

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => queryResult(),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertValues(value);
        return {
          returning: () => Promise.resolve(insertRows()),
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateValues(value);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
}

function queryResult() {
  return {
    limit: () => Promise.resolve(selectQueue.shift() ?? []),
    then: (
      resolve: (value: Rows) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  insertRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
});

describe("n8n workflow discovery", () => {
  it("pulls workflows from the n8n public API and combines Thinkwork connection state", async () => {
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
      [
        {
          id: "binding-1",
          workflow_id: "workflow-1",
          external_workflow_id: "wf-1",
          external_workflow_name: "Fulfillment follow-up",
        },
      ],
    );
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        "X-N8N-API-KEY": "n8n_test_key",
      });
      if (url === "https://n8n.example.test/api/v1/workflows/wf-2") {
        return new Response(
          JSON.stringify({
            id: "wf-2",
            name: "Inactive draft",
            active: false,
            nodes: [{ type: "n8n-nodes-base.manualTrigger" }],
          }),
          { status: 200 },
        );
      }
      expect(url).toBe("https://n8n.example.test/api/v1/workflows?limit=100");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "wf-1",
              name: "Fulfillment follow-up",
              active: true,
              triggerTypes: ["webhook"],
              updatedAt: "2026-06-20T12:00:00.000Z",
            },
            {
              id: "wf-2",
              name: "Inactive draft",
              active: false,
            },
          ],
          nextCursor: null,
        }),
        { status: 200 },
      );
    });

    const result = await discoverN8nWorkflows(
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.workflows).toEqual([
      expect.objectContaining({
        externalWorkflowId: "wf-1",
        connectedWorkflowId: "workflow-1",
        connectedBindingId: "binding-1",
        readinessState: "ready",
      }),
      expect.objectContaining({
        externalWorkflowId: "wf-2",
        connectedWorkflowId: null,
        readinessState: "blocked_not_ready",
        triggerTypes: ["manual"],
        readinessReasons: [
          expect.objectContaining({ code: "n8n_workflow_inactive" }),
        ],
      }),
    ]);
  });

  it("blocks discovery clearly when the n8n public API key is missing", async () => {
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
      [],
    );

    const result = await discoverN8nWorkflows(fakeDb(), {
      tenantId: "tenant-1",
      installId: "install-n8n",
    });

    expect(result.readinessState).toBe("blocked_not_ready");
    expect(result.readinessReasons).toEqual([
      expect.objectContaining({ code: "n8n_api_key_missing" }),
    ]);
    expect(result.workflows).toEqual([]);
  });

  it("connects a discovered n8n workflow into workflow identity, version, binding, and trigger rows", async () => {
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
      [],
    );
    insertRows
      .mockReturnValueOnce([{ id: "workflow-1" }])
      .mockReturnValueOnce([{ id: "version-1" }])
      .mockReturnValueOnce([{ id: "binding-1" }])
      .mockReturnValueOnce([]);

    const result = await connectN8nWorkflow(fakeDb(), {
      tenantId: "tenant-1",
      installId: "install-n8n",
      externalWorkflowId: "n8n wf/id",
      externalWorkflowName: "CRM enrichment",
      active: true,
      triggerTypes: ["webhook", "schedule"],
    });

    expect(result).toEqual({
      workflowId: "workflow-1",
      bindingId: "binding-1",
      created: true,
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "n8n-n8n-wf-id",
        primary_trigger_family: "n8n",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        binding_type: "n8n_bridge",
        external_workflow_id: "n8n wf/id",
        plugin_install_id: "install-n8n",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_family: "n8n",
        idempotency_required: true,
      }),
    );
  });

  it("normalizes external workflow ids into stable slugs", () => {
    expect(n8nWorkflowSlug("CRM / Enrich #1")).toBe("n8n-crm-enrich-1");
  });

  it("archives the ThinkWork projection when unlinking a missing n8n workflow", async () => {
    selectQueue.push([{ id: "binding-1", workflow_id: "workflow-1" }]);

    const result = await disconnectN8nWorkflow(fakeDb(), {
      tenantId: "tenant-1",
      workflowId: "workflow-1",
    });

    expect(result).toEqual({
      workflowId: "workflow-1",
      bindingId: "binding-1",
    });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        binding_status: "archived",
        readiness_state: "disabled",
      }),
    );
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        readiness_state: "disabled",
      }),
    );
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle_status: "archived",
        readiness_state: "disabled",
      }),
    );
  });
});
