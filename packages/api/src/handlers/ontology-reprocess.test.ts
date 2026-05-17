import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunOntologyReprocess } = vi.hoisted(() => ({
  mockRunOntologyReprocess: vi.fn(),
}));

vi.mock("../lib/ontology/reprocess.js", () => ({
  runOntologyReprocess: mockRunOntologyReprocess,
}));

import { handler } from "./ontology-reprocess.js";

describe("ontology-reprocess handler", () => {
  beforeEach(() => {
    mockRunOntologyReprocess.mockReset();
  });

  it("runs a specific durable reprocess job when jobId is provided", async () => {
    mockRunOntologyReprocess.mockResolvedValue({
      ok: true,
      status: "succeeded",
      jobId: "job-1",
      metrics: { affectedPages: 2 },
    });

    const response = await handler({ jobId: "job-1" });

    expect(response.statusCode).toBe(200);
    expect(mockRunOntologyReprocess).toHaveBeenCalledWith({
      jobId: "job-1",
    });
  });

  it("claims the next pending job when no jobId is provided", async () => {
    mockRunOntologyReprocess.mockResolvedValue({
      ok: true,
      status: "no_job",
    });

    const response = await handler({});

    expect(response.statusCode).toBe(200);
    expect(mockRunOntologyReprocess).toHaveBeenCalledWith({
      jobId: undefined,
    });
  });

  it("returns a failing response when processing fails", async () => {
    mockRunOntologyReprocess.mockResolvedValue({
      ok: false,
      status: "failed",
      jobId: "job-1",
      error: "apply exploded",
    });

    const response = await handler({ jobId: "job-1" });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe("apply exploded");
  });
});
