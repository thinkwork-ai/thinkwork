import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireTenantAdmin, mockStartOntologySuggestionScanJob } =
  vi.hoisted(() => ({
    mockRequireTenantAdmin: vi.fn(),
    mockStartOntologySuggestionScanJob: vi.fn(),
  }));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../../../lib/ontology/suggestions.js", () => ({
  startOntologySuggestionScanJob: mockStartOntologySuggestionScanJob,
}));

import { startOntologySuggestionScanMutation } from "./startOntologySuggestionScan.mutation.js";

const ctx = { auth: { authType: "cognito" } } as any;

describe("startOntologySuggestionScan", () => {
  beforeEach(() => {
    mockRequireTenantAdmin.mockReset();
    mockStartOntologySuggestionScanJob.mockReset();
    mockRequireTenantAdmin.mockResolvedValue("admin");
  });

  it("requires tenant admin and returns the queued scan job quickly", async () => {
    mockStartOntologySuggestionScanJob.mockResolvedValue({
      id: "scan-1",
      status: "PENDING",
      result: { invoke: { state: "invoked" } },
    });

    const result = await startOntologySuggestionScanMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          trigger: "manual",
          dedupeKey: "tenant-1:scan",
        },
      },
      ctx,
    );

    expect(result.id).toBe("scan-1");
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockStartOntologySuggestionScanJob).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      trigger: "manual",
      dedupeKey: "tenant-1:scan",
    });
  });

  it("does not enqueue scans for non-admin callers", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      startOntologySuggestionScanMutation(
        null,
        { input: { tenantId: "tenant-1" } },
        ctx,
      ),
    ).rejects.toThrow("forbidden");

    expect(mockStartOntologySuggestionScanJob).not.toHaveBeenCalled();
  });
});
