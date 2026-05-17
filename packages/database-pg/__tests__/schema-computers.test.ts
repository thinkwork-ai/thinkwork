import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  computerAssignments,
  computerEvents,
  computerSnapshots,
  computerTasks,
  computers,
} from "../src/schema/computers";
import { agentTemplates } from "../src/schema/agent-templates";

describe("ThinkWork Computer schema", () => {
  it("defines first-class Computer ownership columns", () => {
    const columns = getTableColumns(computers);

    expect(getTableName(computers)).toBe("computers");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.owner_user_id.notNull).toBe(false);
    expect(columns.template_id.notNull).toBe(true);
    expect(columns.scope.notNull).toBe(true);
    expect(columns.scope.default).toBe("shared");
    expect(columns.status.notNull).toBe(true);
    expect(columns.desired_runtime_status.notNull).toBe(true);
    expect(columns.runtime_status.notNull).toBe(true);
    expect(columns.migrated_from_agent_id.notNull).toBe(false);
  });

  it("defines shared Computer assignment records", () => {
    const columns = getTableColumns(computerAssignments);

    expect(getTableName(computerAssignments)).toBe("computer_assignments");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.computer_id.notNull).toBe(true);
    expect(columns.subject_type.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(false);
    expect(columns.team_id.notNull).toBe(false);
    expect(columns.role.notNull).toBe(true);
    expect(columns.role.default).toBe("member");
    expect(columns.assigned_by_user_id.notNull).toBe(false);
  });

  it("defines Computer-owned work tables for later runtime phases", () => {
    expect(getTableName(computerTasks)).toBe("computer_tasks");
    expect(getTableName(computerEvents)).toBe("computer_events");
    expect(getTableName(computerSnapshots)).toBe("computer_snapshots");

    expect(getTableColumns(computerTasks).computer_id.notNull).toBe(true);
    expect(getTableColumns(computerEvents).computer_id.notNull).toBe(true);
    expect(getTableColumns(computerSnapshots).computer_id.notNull).toBe(true);
  });

  it("types templates without replacing the existing template table", () => {
    const columns = getTableColumns(agentTemplates);

    expect(columns.template_kind.notNull).toBe(true);
    expect(columns.template_kind.default).toBe("agent");
  });
});
