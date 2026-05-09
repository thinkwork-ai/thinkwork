import { describe, expect, it } from "vitest";
import {
  COMPUTER_ARTIFACTS_ROUTE,
  COMPUTER_CUSTOMIZE_ROUTE,
  COMPUTER_MEMORY_ROUTE,
  COMPUTER_NEW_THREAD_ROUTE,
  COMPUTER_ROUTE_LABELS,
  COMPUTER_THREADS_ROUTE,
  InvalidComputerRouteParamError,
  computerArtifactRoute,
  computerThreadRoute,
} from "./computer-routes";

describe("computer route helpers", () => {
  it("builds artifact URLs for generated artifact routes", () => {
    expect(computerArtifactRoute("artifact_123")).toBe(
      "/artifacts/artifact_123",
    );
  });

  it("builds thread detail URLs", () => {
    expect(computerThreadRoute("thread-abc")).toBe("/threads/thread-abc");
  });

  it("throws a typed client error for unsafe artifact ids", () => {
    expect(() => computerArtifactRoute("../artifact")).toThrow(
      InvalidComputerRouteParamError,
    );
  });

  it("keeps labels aligned with the threads route", () => {
    expect(COMPUTER_THREADS_ROUTE).toBe("/threads");
    expect(COMPUTER_NEW_THREAD_ROUTE).toBe("/new");
    expect(COMPUTER_ARTIFACTS_ROUTE).toBe("/artifacts");
    expect(COMPUTER_MEMORY_ROUTE).toBe("/memory");
    expect(COMPUTER_ROUTE_LABELS.threads).toBe("Threads");
    expect(COMPUTER_ROUTE_LABELS.newThread).toBe("New");
    expect(COMPUTER_ROUTE_LABELS.artifacts).toBe("Artifacts");
    expect(COMPUTER_ROUTE_LABELS.memory).toBe("Memory");
  });

  it("exposes the customize route constant + label", () => {
    expect(COMPUTER_CUSTOMIZE_ROUTE).toBe("/customize");
    expect(COMPUTER_ROUTE_LABELS.customize).toBe("Customize");
  });
});
