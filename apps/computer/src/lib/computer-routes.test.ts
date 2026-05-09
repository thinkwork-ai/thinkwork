import { describe, expect, it } from "vitest";
import {
  COMPUTER_ROUTE_LABELS,
  COMPUTER_MEMORY_ROUTE,
  COMPUTER_NEW_THREAD_ROUTE,
  COMPUTER_WORKBENCH_ROUTE,
  InvalidComputerRouteParamError,
  computerAppArtifactRoute,
  computerThreadRoute,
} from "./computer-routes";

describe("computer route helpers", () => {
  it("builds app artifact URLs for generated app split-view routes", () => {
    expect(computerAppArtifactRoute("artifact_123")).toBe("/apps/artifact_123");
  });

  it("builds thread detail URLs", () => {
    expect(computerThreadRoute("thread-abc")).toBe("/threads/thread-abc");
  });

  it("throws a typed client error for unsafe artifact ids", () => {
    expect(() => computerAppArtifactRoute("../artifact")).toThrow(
      InvalidComputerRouteParamError,
    );
  });

  it("keeps labels aligned with the workbench route", () => {
    expect(COMPUTER_WORKBENCH_ROUTE).toBe("/computer");
    expect(COMPUTER_NEW_THREAD_ROUTE).toBe("/threads");
    expect(COMPUTER_MEMORY_ROUTE).toBe("/memory");
    expect(COMPUTER_ROUTE_LABELS.computer).toBe("Computer");
    expect(COMPUTER_ROUTE_LABELS.newThread).toBe("New");
    expect(COMPUTER_ROUTE_LABELS.memory).toBe("Memory");
  });
});
