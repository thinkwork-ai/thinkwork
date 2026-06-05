import { describe, expect, it } from "vitest";
import { buildCogneeDatasetName } from "./runs.js";

describe("buildCogneeDatasetName", () => {
  it("can scope Cognee datasets to a specific ingest run", () => {
    expect(buildCogneeDatasetName("tenant-1", "thread-1", "run-1")).toBe(
      "thinkwork:tenant-1:thread:thread-1:run:run-1",
    );
  });

  it("preserves the legacy thread-scoped form when no run id is provided", () => {
    expect(buildCogneeDatasetName("tenant-1", "thread-1")).toBe(
      "thinkwork:tenant-1:thread:thread-1",
    );
  });
});
