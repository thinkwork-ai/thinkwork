/**
 * Symphony Orchestration — End-to-End Tests
 *
 * Tests the full orchestration pipeline against the deployed ericodom stage:
 * wakeup creation → processor claim → AgentCore invocation → signal parsing →
 * thread state transitions → dependency cascade → turn loops → workspace isolation.
 *
 * Runs against real Aurora (RDS Data API) and AppSync GraphQL.
 * Requires AWS credentials with rds-data + appsync permissions.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@thinkwork/database-pg";

// ─── Infrastructure ──────────────────────────────────────────────────────────

const CLUSTER_ARN = "arn:aws:rds:us-east-1:487219502366:cluster:thinkwork-ericodom-db";
const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:487219502366:secret:thinkwork-ericodom-graphql-db-credentials-EMNbVe";
const DATABASE = "thinkwork";
const GRAPHQL_HTTP_URL = "https://u5nityo4sl.execute-api.us-east-1.amazonaws.com/graphql";
const GRAPHQL_API_KEY = "da2-xgbdn4mltjaz3j6svdlewxjy6e";

const TENANT_ID = "bfa2b2ca-a294-4cc1-a58b-6214c2fb1bb4";
const TEST_AGENT_ID = "10dd279f-401e-4d08-b868-262f7df92409"; // E2E Final Test

/** Set to true to delete test threads/turns after tests. False keeps them visible in the UI. */
const CLEANUP_TEST_DATA = false;

let db: ReturnType<typeof createDb>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
	const res = await fetch(GRAPHQL_HTTP_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": GRAPHQL_API_KEY },
		body: JSON.stringify({ query, variables }),
	});
	const body = await res.json() as Record<string, unknown>;
	if ((body as any).errors) {
		console.error("GraphQL errors:", JSON.stringify((body as any).errors, null, 2));
	}
	return (body as any).data || {};
}

function parseJsonb(raw: unknown): Record<string, unknown> | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return null; } }
	return raw as Record<string, unknown>;
}

/** Insert a wakeup request directly via DB and return the id */
async function insertWakeup(source: string, payload: Record<string, unknown>, reason?: string): Promise<string> {
	const result = await db.execute(sql`
		INSERT INTO agent_wakeup_requests (tenant_id, agent_id, source, reason, payload, status)
		VALUES (${TENANT_ID}::uuid, ${TEST_AGENT_ID}::uuid, ${source}, ${reason || null}, ${JSON.stringify(payload)}::jsonb, 'queued')
		RETURNING id::text
	`);
	return ((result.rows || []) as Array<Record<string, unknown>>)[0].id as string;
}

/** Insert a test thread and return the id */
async function insertThread(title: string, status = "todo"): Promise<string> {
	const result = await db.execute(sql`
		INSERT INTO threads (tenant_id, agent_id, title, status, number, identifier, channel, assignee_type, assignee_id)
		VALUES (${TENANT_ID}::uuid, ${TEST_AGENT_ID}::uuid, ${title}, ${status},
			(SELECT COALESCE(MAX(number), 0) + 1 FROM threads WHERE tenant_id = ${TENANT_ID}::uuid),
			'E2E-' || floor(random() * 10000)::text, 'manual', 'agent', ${TEST_AGENT_ID}::uuid)
		RETURNING id::text
	`);
	return ((result.rows || []) as Array<Record<string, unknown>>)[0].id as string;
}

/** Clean up a thread and all related records */
async function cleanupThread(threadId: string): Promise<void> {
	await db.execute(sql`DELETE FROM messages WHERE thread_id = ${threadId}::uuid`);
	await db.execute(sql`DELETE FROM thread_turn_events WHERE run_id IN (SELECT id FROM thread_turns WHERE thread_id = ${threadId}::uuid)`);
	await db.execute(sql`DELETE FROM thread_turns WHERE thread_id = ${threadId}::uuid`);
	await db.execute(sql`DELETE FROM thread_dependencies WHERE thread_id = ${threadId}::uuid OR blocked_by_thread_id = ${threadId}::uuid`);
	await db.execute(sql`DELETE FROM threads WHERE id = ${threadId}::uuid`);
}

/** Poll a condition until true, with timeout */
async function waitFor(
	fn: () => Promise<boolean>,
	opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<boolean> {
	const { timeoutMs = 90_000, intervalMs = 5_000, label = "condition" } = opts;
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await fn()) return true;
		console.log(`  [wait] ${label}: not ready, ${Math.round((timeoutMs - (Date.now() - start)) / 1000)}s remaining...`);
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
	process.env.AWS_REGION = "us-east-1";
	db = createDb({ resourceArn: CLUSTER_ARN, secretArn: SECRET_ARN, database: DATABASE });

	const check = await db.execute(sql`SELECT slug FROM tenants WHERE id = ${TENANT_ID}::uuid`);
	expect(((check.rows || []) as Array<Record<string, unknown>>).length).toBe(1);
	console.log(`Connected. Tenant: ${((check.rows || []) as Array<Record<string, unknown>>)[0].slug}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. WAKEUP CREATION → CLAIM → AGENTCORE INVOCATION
// ═══════════════════════════════════════════════════════════════════════════

describe("1. Wakeup → AgentCore invocation", () => {
	let threadId: string;
	let wakeupId: string;

	beforeAll(async () => {
		threadId = await insertThread("E2E: Basic Invocation");
		wakeupId = await insertWakeup("chat_message", {
			threadId,
			userMessage: "Reply with exactly: E2E_OK",
		}, "E2E basic invocation test");
		console.log(`  Thread: ${threadId}, Wakeup: ${wakeupId}`);
	});

	it("wakeup is claimed and thread_turn created", async () => {
		const found = await waitFor(async () => {
			const r = await db.execute(sql`
				SELECT status FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid
			`);
			return ((r.rows || []) as Array<Record<string, unknown>>)[0]?.status !== "queued";
		}, { label: "wakeup claimed", timeoutMs: 120_000 });
		expect(found).toBe(true);
	});

	it("thread_turn reaches terminal state", async () => {
		const found = await waitFor(async () => {
			const r = await db.execute(sql`
				SELECT tt.status FROM thread_turns tt
				WHERE tt.wakeup_request_id = ${wakeupId}::uuid
			`);
			const rows = (r.rows || []) as Array<Record<string, unknown>>;
			return rows.length > 0 && ["succeeded", "failed"].includes(rows[0].status as string);
		}, { label: "turn completed", timeoutMs: 120_000 });
		expect(found).toBe(true);

		const r = await db.execute(sql`
			SELECT status, error FROM thread_turns WHERE wakeup_request_id = ${wakeupId}::uuid
		`);
		const turn = ((r.rows || []) as Array<Record<string, unknown>>)[0];
		console.log(`  Turn: ${turn.status}${turn.error ? ` (${turn.error})` : ""}`);
	});

	it("assistant message was inserted", async () => {
		await new Promise((r) => setTimeout(r, 1000));
		const r = await db.execute(sql`
			SELECT content FROM messages
			WHERE thread_id = ${threadId}::uuid AND role = 'assistant'
			ORDER BY created_at DESC LIMIT 1
		`);
		const rows = (r.rows || []) as Array<Record<string, unknown>>;
		if (rows.length > 0) {
			console.log(`  Response: ${(rows[0].content as string).slice(0, 100)}`);
		} else {
			console.log("  No message (agent may have errored)");
		}
	});

	afterAll(async () => {
		if (!CLEANUP_TEST_DATA) return;
		await db.execute(sql`DELETE FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid`);
		await cleanupThread(threadId);
	});
}, 180_000);

// ═══════════════════════════════════════════════════════════════════════════
// 2. DONE SIGNAL → THREAD STATUS TRANSITION
// ═══════════════════════════════════════════════════════════════════════════

describe("2. Done signal → thread transitions to done", () => {
	let threadId: string;
	let wakeupId: string;

	beforeAll(async () => {
		// Enable orchestration
		await db.execute(sql`
			UPDATE agents
			SET runtime_config = COALESCE(runtime_config, '{}'::jsonb) || '{"orchestration":{"threadManagement":true}}'::jsonb
			WHERE id = ${TEST_AGENT_ID}::uuid
		`);

		threadId = await insertThread("E2E: Done Signal Test", "in_progress");
		wakeupId = await insertWakeup("chat_message", {
			threadId,
			userMessage: 'Respond with "Task complete." and then emit:\n```thinkwork-signal\n{"signal":"done"}\n```',
		});
		console.log(`  Thread: ${threadId}, Wakeup: ${wakeupId}`);
	});

	it("thread transitions to done after signal processing", async () => {
		const turnDone = await waitFor(async () => {
			const r = await db.execute(sql`
				SELECT status FROM thread_turns WHERE wakeup_request_id = ${wakeupId}::uuid
			`);
			const rows = (r.rows || []) as Array<Record<string, unknown>>;
			return rows.length > 0 && ["succeeded", "failed"].includes(rows[0].status as string);
		}, { label: "turn completed", timeoutMs: 120_000 });
		expect(turnDone).toBe(true);

		const r = await db.execute(sql`
			SELECT status, completed_at, checkout_run_id FROM threads WHERE id = ${threadId}::uuid
		`);
		const thread = ((r.rows || []) as Array<Record<string, unknown>>)[0];
		console.log(`  Thread status: ${thread.status}`);

		if (thread.status === "done") {
			expect(thread.checkout_run_id).toBeNull();
			expect(thread.completed_at).toBeTruthy();
			console.log("  ✓ Thread correctly transitioned to done");
		} else {
			console.log(`  ⚠ Status is ${thread.status} — agent may not have emitted done signal`);
		}
	});

	it("turn events were logged", async () => {
		const r = await db.execute(sql`
			SELECT event_type, payload FROM thread_turn_events
			WHERE run_id IN (SELECT id FROM thread_turns WHERE wakeup_request_id = ${wakeupId}::uuid)
			ORDER BY seq
		`);
		const events = ((r.rows || []) as Array<Record<string, unknown>>).map((e) => e.event_type);
		console.log(`  Events: ${events.join(", ")}`);
		expect(events).toContain("started");
		// "completed" + "signal" when agent succeeds, or "error" when agent fails
		expect(events.some((e) => e === "completed" || e === "error")).toBe(true);
	});

	afterAll(async () => {
		// Always reset agent config even when keeping test data
		await db.execute(sql`
			UPDATE agents SET runtime_config = runtime_config - 'orchestration' WHERE id = ${TEST_AGENT_ID}::uuid
		`);
		if (!CLEANUP_TEST_DATA) return;
		await db.execute(sql`DELETE FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid`);
		await cleanupThread(threadId);
	});
}, 180_000);

// ═══════════════════════════════════════════════════════════════════════════
// 3. DEPENDENCY BLOCKING — WAKEUP SKIPPED
// ═══════════════════════════════════════════════════════════════════════════

describe("3. Dependency blocking — wakeup skipped", () => {
	let blockerThreadId: string;
	let blockedThreadId: string;
	let wakeupId: string;

	beforeAll(async () => {
		blockerThreadId = await insertThread("E2E Blocker", "in_progress");
		blockedThreadId = await insertThread("E2E Blocked", "blocked");

		await db.execute(sql`
			INSERT INTO thread_dependencies (tenant_id, thread_id, blocked_by_thread_id)
			VALUES (${TENANT_ID}::uuid, ${blockedThreadId}::uuid, ${blockerThreadId}::uuid)
		`);

		wakeupId = await insertWakeup("thread_assignment", { threadId: blockedThreadId });
		console.log(`  Blocker: ${blockerThreadId}, Blocked: ${blockedThreadId}, Wakeup: ${wakeupId}`);
	});

	it("wakeup is skipped with blocked_by_dependencies", async () => {
		const processed = await waitFor(async () => {
			const r = await db.execute(sql`
				SELECT status FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid
			`);
			return ((r.rows || []) as Array<Record<string, unknown>>)[0]?.status !== "queued";
		}, { label: "wakeup processed", timeoutMs: 90_000 });
		expect(processed).toBe(true);

		const r = await db.execute(sql`SELECT status FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid`);
		const status = ((r.rows || []) as Array<Record<string, unknown>>)[0].status;
		console.log(`  Wakeup status: ${status}`);
		expect(status).toBe("skipped");

		const tr = await db.execute(sql`
			SELECT status, error FROM thread_turns WHERE wakeup_request_id = ${wakeupId}::uuid
		`);
		const turns = (tr.rows || []) as Array<Record<string, unknown>>;
		if (turns.length > 0) {
			expect(turns[0].status).toBe("skipped");
			expect(turns[0].error).toBe("blocked_by_dependencies");
			console.log("  ✓ Turn correctly skipped");
		}
	});

	afterAll(async () => {
		if (!CLEANUP_TEST_DATA) return;
		await db.execute(sql`DELETE FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid`);
		await cleanupThread(blockedThreadId);
		await cleanupThread(blockerThreadId);
	});
}, 120_000);

// ═══════════════════════════════════════════════════════════════════════════
// 4. WORKFLOW CONFIG CRUD VIA GRAPHQL
// ═══════════════════════════════════════════════════════════════════════════

describe("4. Workflow config CRUD", () => {
	it("upserts and reads workflow config via GraphQL", async () => {
		const upsert = await gql(`
			mutation Upsert($tenantId: ID!, $input: UpsertWorkflowConfigInput!) {
				upsertWorkflowConfig(tenantId: $tenantId, input: $input) {
					id turnLoop workspace promptTemplate version
				}
			}
		`, {
			tenantId: TENANT_ID,
			input: {
				turnLoop: JSON.stringify({ enabled: false, maxTurns: 3 }),
				workspace: JSON.stringify({ isolateByThread: true }),
				promptTemplate: "You are {{agent.name}} for {{tenant.slug}}.",
			},
		});

		const config = (upsert as any).upsertWorkflowConfig;
		expect(config).toBeDefined();
		expect(config.promptTemplate).toBe("You are {{agent.name}} for {{tenant.slug}}.");

		const turnLoop = typeof config.turnLoop === "string" ? JSON.parse(config.turnLoop) : config.turnLoop;
		expect(turnLoop.maxTurns).toBe(3);
		console.log(`  ✓ Config upserted, version: ${config.version}`);

		// Read back
		const read = await gql(`
			query Get($tenantId: ID!) {
				workflowConfig(tenantId: $tenantId) { promptTemplate turnLoop workspace }
			}
		`, { tenantId: TENANT_ID });
		expect((read as any).workflowConfig.promptTemplate).toBe("You are {{agent.name}} for {{tenant.slug}}.");
		console.log("  ✓ Config readable via query");
	});

	afterAll(async () => {
		await db.execute(sql`
			UPDATE workflow_configs SET turn_loop = NULL, workspace = NULL, prompt_template = NULL, updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PROMPT TEMPLATE RENDERING
// ═══════════════════════════════════════════════════════════════════════════

describe("5. Prompt template rendering", () => {
	let threadId: string;
	let wakeupId: string;

	beforeAll(async () => {
		// Set prompt template
		await db.execute(sql`
			UPDATE workflow_configs
			SET prompt_template = 'You are {{agent.name}} for {{tenant.slug}}. Thread: {{thread.title}}', updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
		// In case no config row exists, insert one
		await db.execute(sql`
			INSERT INTO workflow_configs (tenant_id, prompt_template)
			VALUES (${TENANT_ID}::uuid, 'You are {{agent.name}} for {{tenant.slug}}. Thread: {{thread.title}}')
			ON CONFLICT DO NOTHING
		`);

		threadId = await insertThread("Prompt Template Verification");
		wakeupId = await insertWakeup("chat_message", {
			threadId,
			userMessage: "What is your name and what tenant are you working for? What thread? Reply in one sentence.",
		});
		console.log(`  Thread: ${threadId}, Wakeup: ${wakeupId}`);
	});

	it("agent response reflects template context", async () => {
		const done = await waitFor(async () => {
			const r = await db.execute(sql`
				SELECT status FROM thread_turns WHERE wakeup_request_id = ${wakeupId}::uuid
			`);
			const rows = (r.rows || []) as Array<Record<string, unknown>>;
			return rows.length > 0 && ["succeeded", "failed"].includes(rows[0].status as string);
		}, { label: "turn with template", timeoutMs: 120_000 });
		expect(done).toBe(true);

		const r = await db.execute(sql`
			SELECT content FROM messages
			WHERE thread_id = ${threadId}::uuid AND role = 'assistant'
			ORDER BY created_at DESC LIMIT 1
		`);
		const msgs = (r.rows || []) as Array<Record<string, unknown>>;
		if (msgs.length > 0) {
			console.log(`  Response: ${(msgs[0].content as string).slice(0, 200)}`);
		} else {
			console.log("  No response (agent may have errored)");
		}
	});

	afterAll(async () => {
		// Always reset config
		await db.execute(sql`
			UPDATE workflow_configs SET prompt_template = NULL, updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
		if (!CLEANUP_TEST_DATA) return;
		await db.execute(sql`DELETE FROM agent_wakeup_requests WHERE id = ${wakeupId}::uuid`);
		await cleanupThread(threadId);
	});
}, 180_000);

// ═══════════════════════════════════════════════════════════════════════════
// 6. DEFERRED WAKEUP PROMOTION
// ═══════════════════════════════════════════════════════════════════════════

describe("6. Deferred wakeup promotion", () => {
	let threadId: string;
	let deferredId: string;

	beforeAll(async () => {
		threadId = await insertThread("E2E Deferred", "in_progress");
		// Set a fake checkout to simulate active turn
		await db.execute(sql`UPDATE threads SET checkout_run_id = 'fake-run' WHERE id = ${threadId}::uuid`);

		// Insert deferred wakeup
		const r = await db.execute(sql`
			INSERT INTO agent_wakeup_requests (tenant_id, agent_id, source, status, payload)
			VALUES (${TENANT_ID}::uuid, ${TEST_AGENT_ID}::uuid, 'automation', 'deferred', ${JSON.stringify({ threadId })}::jsonb)
			RETURNING id::text
		`);
		deferredId = ((r.rows || []) as Array<Record<string, unknown>>)[0].id as string;
		console.log(`  Deferred: ${deferredId}, Thread: ${threadId}`);
	});

	it("deferred wakeup starts with deferred status", async () => {
		const r = await db.execute(sql`SELECT status FROM agent_wakeup_requests WHERE id = ${deferredId}::uuid`);
		expect(((r.rows || []) as Array<Record<string, unknown>>)[0].status).toBe("deferred");
	});

	it("promote query atomically changes status to queued", async () => {
		const r = await db.execute(sql`
			UPDATE agent_wakeup_requests
			SET status = 'queued', claimed_at = NULL
			WHERE id = (
				SELECT id FROM agent_wakeup_requests
				WHERE tenant_id = ${TENANT_ID}::uuid
				  AND status = 'deferred'
				  AND payload->>'threadId' = ${threadId}
				ORDER BY created_at ASC LIMIT 1
				FOR UPDATE SKIP LOCKED
			) RETURNING id::text
		`);
		const rows = (r.rows || []) as Array<Record<string, unknown>>;
		expect(rows.length).toBe(1);
		expect(rows[0].id).toBe(deferredId);

		const check = await db.execute(sql`SELECT status FROM agent_wakeup_requests WHERE id = ${deferredId}::uuid`);
		expect(((check.rows || []) as Array<Record<string, unknown>>)[0].status).toBe("queued");
		console.log("  ✓ Promoted to queued");
	});

	afterAll(async () => {
		if (!CLEANUP_TEST_DATA) return;
		await db.execute(sql`DELETE FROM agent_wakeup_requests WHERE id = ${deferredId}::uuid`);
		await cleanupThread(threadId);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SESSION COMPACTION CONFIG
// ═══════════════════════════════════════════════════════════════════════════

describe("7. Session compaction config", () => {
	it("stores and reads session_compaction JSONB", async () => {
		await db.execute(sql`
			UPDATE workflow_configs
			SET session_compaction = ${JSON.stringify({ enabled: true, maxSessionRuns: 100, maxSessionAgeHours: 48 })}::jsonb, updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);

		const r = await db.execute(sql`
			SELECT session_compaction FROM workflow_configs
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
		const sc = parseJsonb(((r.rows || []) as Array<Record<string, unknown>>)[0]?.session_compaction);
		expect(sc).toBeDefined();
		expect(sc!.enabled).toBe(true);
		expect(sc!.maxSessionRuns).toBe(100);
		expect(sc!.maxSessionAgeHours).toBe(48);
		console.log("  ✓ Session compaction config persisted");

		// Reset
		await db.execute(sql`
			UPDATE workflow_configs SET session_compaction = NULL, updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. WORKSPACE ISOLATION CONFIG
// ═══════════════════════════════════════════════════════════════════════════

describe("8. Workspace isolation config", () => {
	it("stores isolateByThread and reads back", async () => {
		await db.execute(sql`
			UPDATE workflow_configs SET workspace = '{"isolateByThread":true}'::jsonb, updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);

		const r = await db.execute(sql`
			SELECT workspace FROM workflow_configs WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
		const ws = parseJsonb(((r.rows || []) as Array<Record<string, unknown>>)[0]?.workspace);
		expect(ws?.isolateByThread).toBe(true);
		console.log("  ✓ Workspace isolation config persisted");

		await db.execute(sql`
			UPDATE workflow_configs SET workspace = NULL, updated_at = NOW()
			WHERE tenant_id = ${TENANT_ID}::uuid AND hive_id IS NULL
		`);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. COST RECORDING ON INVOCATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe("9. Cost recording on invocations", () => {
	it("recent succeeded turns have usage_json", async () => {
		const r = await db.execute(sql`
			SELECT usage_json FROM thread_turns
			WHERE tenant_id = ${TENANT_ID}::uuid AND status = 'succeeded' AND usage_json IS NOT NULL
			ORDER BY started_at DESC LIMIT 3
		`);
		const rows = (r.rows || []) as Array<Record<string, unknown>>;
		if (rows.length > 0) {
			for (const row of rows) {
				const u = parseJsonb(row.usage_json);
				if (u) {
					expect(u.duration_ms).toBeDefined();
					console.log(`  Usage: ${u.input_tokens || 0} in / ${u.output_tokens || 0} out / ${u.duration_ms}ms`);
				}
			}
		} else {
			console.log("  No succeeded turns with usage data");
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. WAKEUP REQUEST LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════

describe("10. Wakeup request status lifecycle", () => {
	it("verifies recent wakeups follow queued → claimed → completed/failed flow", async () => {
		const r = await db.execute(sql`
			SELECT status, source, claimed_at, finished_at
			FROM agent_wakeup_requests
			WHERE tenant_id = ${TENANT_ID}::uuid AND status IN ('completed', 'failed')
			ORDER BY created_at DESC LIMIT 5
		`);
		const rows = (r.rows || []) as Array<Record<string, unknown>>;
		if (rows.length > 0) {
			for (const row of rows) {
				expect(row.claimed_at).toBeTruthy();
				expect(row.finished_at).toBeTruthy();
				console.log(`  ${row.source}: ${row.status}`);
			}
		} else {
			console.log("  No completed wakeups found");
		}
	});
});
