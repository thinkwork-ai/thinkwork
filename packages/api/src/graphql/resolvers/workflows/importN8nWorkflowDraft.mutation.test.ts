import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAdmin = vi.fn();

vi.mock("../core/authz.js", () => ({
  requireAdminOrApiKeyCaller: mockRequireAdmin,
}));

let resolver: typeof import("./importN8nWorkflowDraft.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  mockRequireAdmin.mockReset();
  mockRequireAdmin.mockResolvedValue(undefined);
  resolver = await import("./importN8nWorkflowDraft.mutation.js");
});

describe("importN8nWorkflowDraft", () => {
  it("imports a fetched n8n workflow as a reviewable workflow draft", async () => {
    const auth = {
      apiKey: "n8n-key",
      credentialSlug: "n8n-api",
      configuredBaseUrl: "https://n8n.example.com",
    };
    const workflow = {
      id: "workflow-1",
      name: "PDI Fuel Order",
      nodes: [],
      connections: {},
    };
    const fetchWorkflow = vi.fn().mockResolvedValue({
      workflow,
      endpoint: "https://n8n.example.com/api/v1/workflows/workflow-1",
    });
    const createDraft = vi.fn().mockResolvedValue({
      workflow: { id: "workflow-draft-1" },
      workflowVersion: { id: "workflow-version-1" },
      binding: { id: "binding-1" },
      diagnostics: [],
      credentialRequirements: [],
      sourceMetadata: { source: "n8n_import" },
      activationBlocked: false,
    });

    const result = await resolver.importN8nWorkflowDraft(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workflowUrl: "https://n8n.example.com/workflow/workflow-1",
          name: "Imported draft",
          n8nCredentialSlug: "n8n-api",
          pdiCredentialSlug: "pdi-prod",
        },
      },
      { auth: { tenantId: "tenant-1" } } as any,
      {
        db: {} as any,
        loadAuth: vi.fn().mockResolvedValue(auth),
        fetchWorkflow,
        createDraft,
      },
    );

    expect(mockRequireAdmin).toHaveBeenCalledWith(
      { auth: { tenantId: "tenant-1" } },
      "tenant-1",
      "create_workflow",
    );
    expect(fetchWorkflow).toHaveBeenCalledWith({
      workflowUrl: "https://n8n.example.com/workflow/workflow-1",
      auth,
      constraints: { allowedBaseUrl: "https://n8n.example.com" },
    });
    expect(createDraft).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        tenantId: "tenant-1",
        fetchedFrom: "https://n8n.example.com/api/v1/workflows/workflow-1",
        sourceWorkflowId: "workflow-1",
        workflow,
        fetchError: null,
        pdiCredentialSlug: "pdi-prod",
      }),
    );
    expect(result.workflow).toEqual({ id: "workflow-draft-1" });
  });

  it("records fetch failures as draft diagnostics instead of creating an active workflow", async () => {
    const createDraft = vi.fn().mockResolvedValue({
      workflow: { id: "workflow-draft-1" },
      workflowVersion: { id: "workflow-version-1" },
      binding: { id: "binding-1" },
      diagnostics: [
        {
          code: "n8n_fetch_failed",
          severity: "blocker",
          message: "timeout",
        },
      ],
      credentialRequirements: [],
      sourceMetadata: { source: "n8n_import" },
      activationBlocked: true,
    });

    const result = await resolver.importN8nWorkflowDraft(
      null,
      {
        input: {
          tenantId: "tenant-1",
          workflowUrl: "https://n8n.example.com/workflow/workflow-1",
          name: "Unfetched draft",
        },
      },
      { auth: { tenantId: "tenant-1" } } as any,
      {
        db: {} as any,
        loadAuth: vi.fn().mockResolvedValue({
          apiKey: "n8n-key",
          credentialSlug: "n8n-api",
          configuredBaseUrl: "https://n8n.example.com",
        }),
        fetchWorkflow: vi.fn().mockRejectedValue(new Error("timeout")),
        createDraft,
      },
    );

    expect(createDraft).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        sourceWorkflowId: "workflow-1",
        workflow: expect.objectContaining({
          id: "workflow-1",
          name: "Unfetched draft",
          nodes: [],
          connections: {},
        }),
        fetchError: expect.any(Error),
      }),
    );
    expect(result.activationBlocked).toBe(true);
  });

  it("requires an active n8n credential for draft import", async () => {
    await expect(
      resolver.importN8nWorkflowDraft(
        null,
        {
          input: {
            tenantId: "tenant-1",
            workflowUrl: "https://n8n.example.com/workflow/workflow-1",
          },
        },
        { auth: { tenantId: "tenant-1" } } as any,
        {
          db: {} as any,
          loadAuth: vi.fn().mockResolvedValue(null),
        },
      ),
    ).rejects.toThrow("n8n credential was not found");
  });

  it("rejects workflow URLs outside the credential base URL", async () => {
    const createDraft = vi.fn();

    await expect(
      resolver.importN8nWorkflowDraft(
        null,
        {
          input: {
            tenantId: "tenant-1",
            workflowUrl: "https://attacker.example.com/workflow/workflow-1",
          },
        },
        { auth: { tenantId: "tenant-1" } } as any,
        {
          db: {} as any,
          loadAuth: vi.fn().mockResolvedValue({
            apiKey: "n8n-key",
            credentialSlug: "n8n-api",
            configuredBaseUrl: "https://n8n.example.com",
          }),
          createDraft,
        },
      ),
    ).rejects.toThrow("configured credential base URL");

    expect(createDraft).not.toHaveBeenCalled();
  });
});
