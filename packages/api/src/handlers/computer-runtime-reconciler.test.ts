import { describe, expect, it } from "vitest";
import { planComputerRuntimeReconciliation } from "./computer-runtime-reconciler.js";

const now = new Date("2026-05-06T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "computer-1",
    tenant_id: "tenant-1",
    desired_runtime_status: "running",
    runtime_status: "pending",
    ecs_service_name: null,
    last_heartbeat_at: null,
    ...overrides,
  } as any;
}

describe("planComputerRuntimeReconciliation", () => {
  it("provisions desired-running Computers without an ECS service", () => {
    expect(planComputerRuntimeReconciliation(row(), now)).toBe("provision");
  });

  it("starts desired-running Computers with stopped services", () => {
    expect(
      planComputerRuntimeReconciliation(
        row({ ecs_service_name: "svc", runtime_status: "stopped" }),
        now,
      ),
    ).toBe("start");
  });

  it("refreshes stale running Computers through provision", () => {
    expect(
      planComputerRuntimeReconciliation(
        row({
          ecs_service_name: "svc",
          runtime_status: "running",
          last_heartbeat_at: new Date("2026-05-06T11:40:00.000Z"),
        }),
        now,
        15 * 60_000,
      ),
    ).toBe("provision");
  });

  it("stops desired-stopped running Computers", () => {
    expect(
      planComputerRuntimeReconciliation(
        row({
          desired_runtime_status: "stopped",
          runtime_status: "running",
          ecs_service_name: "svc",
        }),
        now,
      ),
    ).toBe("stop");
  });

  it("does nothing for fresh running Computers", () => {
    expect(
      planComputerRuntimeReconciliation(
        row({
          runtime_status: "running",
          ecs_service_name: "svc",
          last_heartbeat_at: new Date("2026-05-06T11:55:00.000Z"),
        }),
        now,
      ),
    ).toBeNull();
  });
});
