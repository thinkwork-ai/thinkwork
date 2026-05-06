import { describe, expect, it } from "vitest";
import { buildComputerMigrationReport } from "./migration-report.js";

const BASE_AGENT = {
  id: "agent-1",
  tenant_id: "tenant-1",
  name: "Eric's Agent",
  slug: "eric-agent",
  human_pair_id: "user-1",
  template_id: "template-1",
  template_kind: "computer",
  runtime_config: null,
  budget_monthly_cents: null,
  spent_monthly_cents: 0,
  last_heartbeat_at: new Date("2026-05-06T12:00:00.000Z"),
  updated_at: new Date("2026-05-06T11:00:00.000Z"),
  created_at: new Date("2026-05-06T10:00:00.000Z"),
};

describe("buildComputerMigrationReport", () => {
  it("marks a single user-paired Agent with a Computer Template as ready", () => {
    const report = buildComputerMigrationReport({
      tenantId: "tenant-1",
      agents: [BASE_AGENT],
      existingComputers: [],
    });

    expect(report.summary.ready).toBe(1);
    expect(report.groups[0]).toMatchObject({
      ownerUserId: "user-1",
      status: "ready",
      primaryAgentId: "agent-1",
    });
  });

  it("reports multiple user-paired Agents before apply", () => {
    const report = buildComputerMigrationReport({
      tenantId: "tenant-1",
      agents: [
        BASE_AGENT,
        {
          ...BASE_AGENT,
          id: "agent-2",
          last_heartbeat_at: new Date("2026-05-06T13:00:00.000Z"),
        },
      ],
      existingComputers: [],
    });

    expect(report.summary.multiple_candidates).toBe(1);
    expect(report.groups[0]).toMatchObject({
      status: "multiple_candidates",
      primaryAgentId: "agent-2",
      agentIds: ["agent-2", "agent-1"],
    });
  });

  it("treats already migrated Computers as idempotent skips", () => {
    const report = buildComputerMigrationReport({
      tenantId: "tenant-1",
      agents: [BASE_AGENT],
      existingComputers: [
        {
          id: "computer-1",
          tenant_id: "tenant-1",
          owner_user_id: "user-1",
          migrated_from_agent_id: "agent-1",
          status: "active",
        },
      ],
    });

    expect(report.summary.already_migrated).toBe(1);
    expect(report.groups[0]).toMatchObject({
      status: "already_migrated",
      existingComputerId: "computer-1",
    });
  });

  it("blocks Agents that are still backed by Agent Templates", () => {
    const report = buildComputerMigrationReport({
      tenantId: "tenant-1",
      agents: [{ ...BASE_AGENT, template_kind: "agent" }],
      existingComputers: [],
    });

    expect(report.summary.template_not_computer).toBe(1);
    expect(report.groups[0]?.reasons[0]).toMatch(/not typed/);
  });
});
