import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunOntologySuggestionScan } = vi.hoisted(() => ({
  mockRunOntologySuggestionScan: vi.fn(),
}));

vi.mock("../lib/ontology/suggestions.js", () => ({
  runOntologySuggestionScan: mockRunOntologySuggestionScan,
}));

import { handler } from "./ontology-scan.js";

describe("ontology-scan handler", () => {
  beforeEach(() => {
    mockRunOntologySuggestionScan.mockReset();
  });

  it("runs the durable ontology scan job", async () => {
    mockRunOntologySuggestionScan.mockResolvedValue({
      status: "succeeded",
      tenantId: "tenant-1",
      jobId: "job-1",
      createdChangeSetIds: ["change-set-1"],
      updatedChangeSetIds: [],
      noOp: false,
    });

    const response = await handler({ tenantId: "tenant-1", jobId: "job-1" });

    expect(response.statusCode).toBe(200);
    expect(mockRunOntologySuggestionScan).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      jobId: "job-1",
    });
  });

  it("rejects malformed events before touching the scanner", async () => {
    await expect(handler({ tenantId: "tenant-1" })).rejects.toThrow(
      /requires tenantId and jobId/,
    );
    expect(mockRunOntologySuggestionScan).not.toHaveBeenCalled();
  });
});
