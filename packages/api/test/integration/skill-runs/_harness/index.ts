/**
 * Integration test harness for the skill-runs surface. See README.md.
 *
 * A harness instance (`createHarness()`) ships all four stubs wired
 * together so a test can do:
 *
 *   const h = createHarness();
 *   h.memory.seedLearnings({ tenantId, skillId, learnings: [...] });
 *   h.tasks.seedExisting({...});
 *   const run = await h.startRun({ skillId, inputs, invocationSource: "chat" });
 *   h.advance(); // drive whichever scripted envelope is next
 *
 * The harness exposes `.calls.invokeSkillRun` and `.calls.skillRuns`
 * so assertions can verify exact counts without touching internals.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Shared types — mirror production shapes without importing them to keep
// the harness tree-shakeable in tests that don't need the full API package.
// ---------------------------------------------------------------------------

export type SkillRunStatus =
	| "running"
	| "complete"
	| "failed"
	| "cancelled"
	| "invoker_deprovisioned"
	| "skipped_disabled"
	| "cost_bounded_error";

export type InvocationSource = "chat" | "scheduled" | "catalog" | "webhook";

export interface SkillRunRow {
	id: string;
	tenant_id: string;
	agent_id: string | null;
	invoker_user_id: string;
	skill_id: string;
	skill_version: number;
	invocation_source: InvocationSource;
	resolved_inputs: Record<string, unknown>;
	resolved_inputs_hash: string;
	triggered_by_run_id: string | null;
	status: SkillRunStatus;
	failure_reason: string | null;
	delivered_artifact_ref: Record<string, unknown> | null;
	started_at: Date;
	finished_at: Date | null;
}

export interface InvokeEnvelope {
	kind: "run_skill";
	runId: string;
	tenantId: string;
	invokerUserId: string;
	skillId: string;
	skillVersion: number;
	invocationSource: string;
	resolvedInputs: Record<string, unknown>;
}

export interface LearningRecord {
	tenantId: string;
	userId?: string;
	skillId: string;
	subjectEntityId?: string;
	text: string;
}

export interface TaskRow {
	id: string;
	tenantId: string;
	subjectKind: string;
	subjectId: string;
	trigger: string;
	summary: string;
	status: "open" | "done";
	triggeredByRunId: string | null;
}

// ---------------------------------------------------------------------------
// Canonicalization — matches packages/api/src/graphql/utils.ts (pinned by
// the shared inlined-helpers contract). The harness uses it for dedup
// assertions without importing production code into the test.
// ---------------------------------------------------------------------------

export function canonicalize(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((v) => canonicalize(v)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export function hashInputs(inputs: Record<string, unknown>): string {
	return createHash("sha256").update(canonicalize(inputs)).digest("hex");
}

// ---------------------------------------------------------------------------
// Stub AgentCore Memory — recall + reflect in-memory
// ---------------------------------------------------------------------------

export class StubAgentCoreMemory {
	private store: LearningRecord[] = [];
	public readonly recallCalls: Array<{
		scope: Omit<LearningRecord, "text">;
	}> = [];
	public readonly reflectCalls: LearningRecord[] = [];

	seedLearnings(records: LearningRecord[]) {
		this.store.push(...records);
	}

	recall(scope: Omit<LearningRecord, "text">): LearningRecord[] {
		this.recallCalls.push({ scope });
		return this.store.filter((r) => {
			if (r.tenantId !== scope.tenantId) return false;
			if (r.skillId !== scope.skillId) return false;
			if (r.userId !== undefined && scope.userId !== undefined) {
				if (r.userId !== scope.userId) return false;
			}
			if (r.subjectEntityId && scope.subjectEntityId) {
				if (r.subjectEntityId !== scope.subjectEntityId) return false;
			}
			return true;
		});
	}

	reflect(record: LearningRecord) {
		this.reflectCalls.push(record);
		this.store.push(record);
	}
}

// ---------------------------------------------------------------------------
// Stub task system — task_system_tasks_list + task_system_tasks_create semantics
// ---------------------------------------------------------------------------

export class StubTaskSystem {
	private tasks: TaskRow[] = [];
	public readonly createCalls: TaskRow[] = [];
	private seq = 1;

	seedExisting(rows: TaskRow[]) {
		this.tasks.push(...rows);
	}

	list(args: { tenantId: string; subjectKind: string; subjectId: string; trigger: string }) {
		return this.tasks.filter(
			(t) =>
				t.tenantId === args.tenantId &&
				t.subjectKind === args.subjectKind &&
				t.subjectId === args.subjectId &&
				t.trigger === args.trigger,
		);
	}

	create(row: Omit<TaskRow, "id" | "status"> & { status?: "open" | "done" }) {
		const full: TaskRow = {
			id: `task-${this.seq++}`,
			status: row.status ?? "open",
			...row,
		};
		this.tasks.push(full);
		this.createCalls.push(full);
		return full;
	}

	complete(taskId: string) {
		const t = this.tasks.find((x) => x.id === taskId);
		if (!t) throw new Error(`task ${taskId} not found`);
		t.status = "done";
		return t;
	}

	allTasks() {
		return [...this.tasks];
	}
}

// ---------------------------------------------------------------------------
// Stub AgentCore invoke — records envelopes, runs a scripted skill run
// ---------------------------------------------------------------------------

export type SkillRunScript = (ctx: {
	envelope: InvokeEnvelope;
	memory: StubAgentCoreMemory;
	tasks: StubTaskSystem;
}) => Promise<{
	ok: true;
	deliverable?: unknown;
	status?: SkillRunStatus;
} | { ok: false; error: string }>;

export class StubAgentCore {
	public readonly envelopes: InvokeEnvelope[] = [];
	private script: SkillRunScript;
	private memory: StubAgentCoreMemory;
	private tasks: StubTaskSystem;

	constructor(
		memory: StubAgentCoreMemory,
		tasks: StubTaskSystem,
		script?: SkillRunScript,
	) {
		this.memory = memory;
		this.tasks = tasks;
		this.script = script ?? (async () => ({ ok: true }));
	}

	setScript(script: SkillRunScript) {
		this.script = script;
	}

	async invoke(envelope: InvokeEnvelope) {
		this.envelopes.push({ ...envelope });
		return this.script({ envelope, memory: this.memory, tasks: this.tasks });
	}
}

// ---------------------------------------------------------------------------
// Mock skill_runs table — just enough of Drizzle to power the startSkillRun
// business logic we care about.
// ---------------------------------------------------------------------------

export class MockSkillRunsTable {
	private rows: SkillRunRow[] = [];
	private seq = 1;

	insertRunning(row: Omit<SkillRunRow, "id" | "started_at" | "finished_at" | "status" | "delivered_artifact_ref" | "failure_reason"> & {
		status?: SkillRunStatus;
	}): SkillRunRow | null {
		// onConflictDoNothing contract: if another `running` row with the
		// same dedup fingerprint exists, return null.
		const clash = this.rows.find(
			(r) =>
				r.tenant_id === row.tenant_id &&
				r.invoker_user_id === row.invoker_user_id &&
				r.skill_id === row.skill_id &&
				r.resolved_inputs_hash === row.resolved_inputs_hash &&
				r.status === "running",
		);
		if (clash) return null;
		const full: SkillRunRow = {
			id: `run-${this.seq++}`,
			started_at: new Date(),
			finished_at: null,
			status: row.status ?? "running",
			delivered_artifact_ref: null,
			failure_reason: null,
			...row,
		};
		this.rows.push(full);
		return full;
	}

	findActive(predicate: Partial<SkillRunRow>): SkillRunRow | undefined {
		return this.rows.find(
			(r) =>
				r.status === "running" &&
				Object.entries(predicate).every(
					([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
				),
		);
	}

	update(id: string, patch: Partial<SkillRunRow>) {
		const r = this.rows.find((x) => x.id === id);
		if (!r) throw new Error(`run ${id} not found`);
		Object.assign(r, patch);
		if (patch.status && patch.status !== "running") {
			r.finished_at = r.finished_at ?? new Date();
		}
		return r;
	}

	all() {
		return [...this.rows];
	}

	byId(id: string) {
		return this.rows.find((r) => r.id === id);
	}
}

// ---------------------------------------------------------------------------
// Harness entry point
// ---------------------------------------------------------------------------

export interface HarnessOptions {
	tenantId?: string;
	invokerUserId?: string;
	systemUserId?: string;
}

export interface StartRunArgs {
	tenantId?: string;
	invokerUserId?: string;
	agentId?: string | null;
	skillId: string;
	skillVersion?: number;
	invocationSource: InvocationSource;
	inputs: Record<string, unknown>;
	triggeredByRunId?: string | null;
}

export interface StartRunResult {
	ok: true;
	runId: string;
	status: SkillRunStatus;
	deduped: boolean;
}

export interface StartRunFailure {
	ok: false;
	status: SkillRunStatus;
	failure_reason: string | null;
}

export function createHarness(opts: HarnessOptions = {}) {
	const tenantId = opts.tenantId ?? "tenant-test";
	const invokerUserId = opts.invokerUserId ?? "user-test";
	const systemUserId = opts.systemUserId ?? "system-user-test";
	const memory = new StubAgentCoreMemory();
	const tasks = new StubTaskSystem();
	const runs = new MockSkillRunsTable();
	const agentcore = new StubAgentCore(memory, tasks);

	async function startRun(args: StartRunArgs): Promise<StartRunResult | StartRunFailure> {
		const invoker = args.invokerUserId ??
			(args.invocationSource === "webhook" ? systemUserId : invokerUserId);
		const hash = hashInputs(args.inputs);
		const inserted = runs.insertRunning({
			tenant_id: args.tenantId ?? tenantId,
			agent_id: args.agentId ?? null,
			invoker_user_id: invoker,
			skill_id: args.skillId,
			skill_version: args.skillVersion ?? 1,
			invocation_source: args.invocationSource,
			resolved_inputs: args.inputs,
			resolved_inputs_hash: hash,
			triggered_by_run_id: args.triggeredByRunId ?? null,
		});

		if (!inserted) {
			const existing = runs.findActive({
				tenant_id: args.tenantId ?? tenantId,
				invoker_user_id: invoker,
				skill_id: args.skillId,
				resolved_inputs_hash: hash,
			});
			if (!existing) {
				return { ok: false, status: "failed", failure_reason: "dedup race" };
			}
			return { ok: true, runId: existing.id, status: existing.status, deduped: true };
		}

		const envelope: InvokeEnvelope = {
			kind: "run_skill",
			runId: inserted.id,
			tenantId: inserted.tenant_id,
			invokerUserId: invoker,
			skillId: args.skillId,
			skillVersion: inserted.skill_version,
			invocationSource: args.invocationSource,
			resolvedInputs: args.inputs,
		};

		const invokeResult = await agentcore.invoke(envelope);
		// Post-invoke: respect terminal transitions that happened while the
		// skill run was running (e.g. an explicit cancelRun). The harness
		// models production behavior where `cancelled` is sticky even if
		// the final envelope reports success.
		const current = runs.byId(inserted.id);
		if (current && current.status !== "running") {
			return {
				ok: true,
				runId: inserted.id,
				status: current.status,
				deduped: false,
			};
		}
		if (!invokeResult.ok) {
			runs.update(inserted.id, {
				status: "failed",
				failure_reason: invokeResult.error.slice(0, 500),
			});
			return { ok: false, status: "failed", failure_reason: invokeResult.error };
		}
		runs.update(inserted.id, {
			status: invokeResult.status ?? "complete",
			delivered_artifact_ref: invokeResult.deliverable
				? { type: "inline", payload: invokeResult.deliverable }
				: null,
		});
		return {
			ok: true,
			runId: inserted.id,
			status: invokeResult.status ?? "complete",
			deduped: false,
		};
	}

	async function cancelRun(runId: string) {
		runs.update(runId, { status: "cancelled" });
	}

	return {
		tenantId,
		invokerUserId,
		systemUserId,
		memory,
		tasks,
		runs,
		agentcore,
		startRun,
		cancelRun,
	};
}

export type Harness = ReturnType<typeof createHarness>;
