import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
	agentWorkspaceEvents,
	agentWorkspaceRuns,
	agentWorkspaceWaits,
	WORKSPACE_EVENT_TYPES,
	WORKSPACE_RUN_STATUSES,
} from "../src/schema/agent-workspace-events";

describe("agent workspace orchestration schema", () => {
	it("defines durable run lifecycle columns", () => {
		const columns = getTableColumns(agentWorkspaceRuns);
		expect(getTableName(agentWorkspaceRuns)).toBe("agent_workspace_runs");
		expect(columns.tenant_id.notNull).toBe(true);
		expect(columns.agent_id.notNull).toBe(true);
		expect(columns.target_path.notNull).toBe(true);
		expect(columns.status.notNull).toBe(true);
		expect(columns.wakeup_retry_count.notNull).toBe(true);
		expect(columns.last_event_at.notNull).toBe(true);
		expect(WORKSPACE_RUN_STATUSES).toContain("awaiting_review");
		expect(WORKSPACE_RUN_STATUSES).toContain("expired");
	});

	it("defines canonical event metadata and v1 event vocabulary", () => {
		const columns = getTableColumns(agentWorkspaceEvents);
		expect(getTableName(agentWorkspaceEvents)).toBe("agent_workspace_events");
		expect(columns.idempotency_key.notNull).toBe(true);
		expect(columns.bucket.notNull).toBe(true);
		expect(columns.source_object_key.notNull).toBe(true);
		expect(columns.sequencer.notNull).toBe(true);
		expect(columns.mirror_status.notNull).toBe(true);
		expect(WORKSPACE_EVENT_TYPES).toEqual([
			"work.requested",
			"run.started",
			"run.blocked",
			"run.completed",
			"run.failed",
			"review.requested",
			"memory.changed",
			"event.rejected",
		]);
	});

	it("defines single-wait relationships for v1 fan-out", () => {
		const columns = getTableColumns(agentWorkspaceWaits);
		expect(getTableName(agentWorkspaceWaits)).toBe("agent_workspace_waits");
		expect(columns.waiting_run_id.notNull).toBe(true);
		expect(columns.wait_for_run_id.notNull).toBe(false);
		expect(columns.wait_for_target_path.notNull).toBe(false);
		expect(columns.status.notNull).toBe(true);
	});
});

