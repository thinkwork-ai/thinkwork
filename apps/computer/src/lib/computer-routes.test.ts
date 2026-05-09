import { describe, expect, it } from "vitest";
import {
  COMPUTER_ROUTE_LABELS,
  COMPUTER_NEW_THREAD_ROUTE,
  COMPUTER_WORKBENCH_ROUTE,
  InvalidComputerRouteParamError,
  computerAppArtifactRoute,
  computerTaskRoute,
} from "./computer-routes";

describe("computer route helpers", () => {
  it("builds app artifact URLs for generated app split-view routes", () => {
    expect(computerAppArtifactRoute("artifact_123")).toBe("/apps/artifact_123");
  });

  it("builds task detail URLs", () => {
    expect(computerTaskRoute("task-abc")).toBe("/tasks/task-abc");
  });

  it("throws a typed client error for unsafe artifact ids", () => {
    expect(() => computerAppArtifactRoute("../artifact")).toThrow(
      InvalidComputerRouteParamError,
    );
  });

  it("keeps labels aligned with the workbench route", () => {
    expect(COMPUTER_WORKBENCH_ROUTE).toBe("/computer");
    expect(COMPUTER_NEW_THREAD_ROUTE).toBe("/tasks");
    expect(COMPUTER_ROUTE_LABELS.computer).toBe("Computer");
    expect(COMPUTER_ROUTE_LABELS.tasks).toBe("New");
  });
});
