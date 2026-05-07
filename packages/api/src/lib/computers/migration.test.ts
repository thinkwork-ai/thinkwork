import { describe, expect, it } from "vitest";
import { buildComputerMigrationReport } from "./migration-report.js";

const BASE_AGENT = {
  id: "agent-1",
  tenant_id: "tenant-1",
  name: "Eric's Agent",
  slug: "eric-agent",
  human_pair_id: "user-1",
  human_name: "Eric Odom",
  human_email: "eric@example.com",
  template_id: "template-1",
  template_kind: "computer",
  template_name: "Founder Computer",
  template_slug: "founder-computer",
  adapter_type: null,
  workspace_run_count: 0,
  thread_count: 0,
  last_thread_at: null,
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
      owner: {
        id: "user-1",
        name: "Eric Odom",
        email: "eric@example.com",
      },
      status: "ready",
      severity: "ready",
      recommendedAction: "create_computer",
      applyDisposition: "create",
      primaryAgentId: "agent-1",
      primaryAgent: {
        id: "agent-1",
        name: "Eric's Agent",
        templateName: "Founder Computer",
      },
    });
  });

  it("selects the workspace-backed Agent when a user has multiple legacy Agents", () => {
    const report = buildComputerMigrationReport({
      tenantId: "tenant-1",
      agents: [
        {
          ...BASE_AGENT,
          id: "agent-1",
          workspace_run_count: 12,
          thread_count: 80,
          adapter_type: "strands",
        },
        {
          ...BASE_AGENT,
          id: "agent-2",
          last_heartbeat_at: new Date("2026-05-06T13:00:00.000Z"),
        },
      ],
      existingComputers: [],
    });

    expect(report.summary.ready).toBe(1);
    expect(report.groups[0]).toMatchObject({
      status: "ready",
      severity: "ready",
      recommendedAction: "create_computer",
      applyDisposition: "create",
      primaryAgentId: "agent-1",
      agentIds: ["agent-1", "agent-2"],
    });
    expect(report.groups[0]?.reasons).toContain(
      "1 additional user-paired Agent(s) remain as delegated Agents",
    );
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
      severity: "info",
      recommendedAction: "skip_existing",
      applyDisposition: "skip",
      existingComputerId: "computer-1",
    });
  });

  it("clones Agents that are still backed by legacy Agent Templates", () => {
    const report = buildComputerMigrationReport({
      tenantId: "tenant-1",
      agents: [{ ...BASE_AGENT, template_kind: "agent" }],
      existingComputers: [],
    });

    expect(report.summary.ready).toBe(1);
    expect(report.summary.template_not_computer).toBe(0);
    expect(report.groups[0]?.reasons).toContain(
      "Source Agent uses a legacy Agent Template and will be cloned as a Computer",
    );
    expect(report.groups[0]).toMatchObject({
      status: "ready",
      severity: "ready",
      recommendedAction: "create_computer",
      applyDisposition: "create",
    });
  });
});
