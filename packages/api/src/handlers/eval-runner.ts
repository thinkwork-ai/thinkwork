/**
 * eval-runner Lambda
 *
 * Invoked asynchronously by the `startEvalRun` GraphQL mutation. For each
 * test case in the run:
 *   1. Invoke the agent under test via InvokeAgentRuntimeCommand with a
 *      unique runtime session ID + matching payload.sessionId. The Strands
 *      runtime's eval_span_attrs hook tags every emitted span with
 *      session.id/tenant.id/agent.id (see
 *      packages/agentcore-strands/agent-container/eval_span_attrs.py).
 *   2. Wait for spans to land in CloudWatch (~30-90s).
 *   3. Fetch spans from `aws/spans` AND OTel log records from the runtime
 *      log group, both filtered by session.id.
 *   4. For each agentcore_evaluator_id on the test case, call
 *      EvaluateCommand with the combined sessionSpans payload (1-per-call
 *      quota means N evaluators = N API calls).
 *   5. Aggregate per-evaluator scores → pass/fail → insert eval_results row.
 *
 * After all tests complete: aggregate run-level pass_rate, mark run
 * status = "completed", record cost_events, notify AppSync.
 *
 * v1 keeps concurrency = 1 (sequential). p-limit can be added later.
 */

import { eq, and, sql, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { evalRuns, evalResults, evalTestCases, costEvents, agentTemplates } from "@thinkwork/database-pg/schema";
import {
	BedrockAgentCoreClient,
	InvokeAgentRuntimeCommand,
	EvaluateCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { createHash } from "crypto";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "487219502366";
const SSM_RUNTIME_ID = process.env.AGENTCORE_RUNTIME_SSM_STRANDS || "/thinkwork/dev/agentcore/runtime-id-strands";
const SPANS_LOG_GROUP = process.env.SPANS_LOG_GROUP || "aws/spans";
const RUNTIME_LOG_GROUP_PREFIX = "/aws/bedrock-agentcore/runtimes/";
const SPAN_WAIT_INITIAL_MS = 30_000;
const SPAN_WAIT_INTERVAL_MS = 15_000;
const SPAN_WAIT_MAX_MS = 120_000;
const PASS_THRESHOLD = 0.7;

const ssm = new SSMClient({ region: REGION });
const ac = new BedrockAgentCoreClient({ region: REGION, requestHandler: { requestTimeout: 660_000 } });
const cw = new CloudWatchLogsClient({ region: REGION });

let cachedRuntimeId: string | null = null;

async function loadRuntimeId(): Promise<string> {
	if (cachedRuntimeId) return cachedRuntimeId;
	const resp = await ssm.send(new GetParameterCommand({ Name: SSM_RUNTIME_ID }));
	if (!resp.Parameter?.Value) throw new Error(`SSM parameter ${SSM_RUNTIME_ID} is empty`);
	cachedRuntimeId = resp.Parameter.Value;
	return cachedRuntimeId;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalRunnerEvent {
	runId: string;
}

interface Assertion {
	type: string; // "contains" | "regex" | "equals" | "json-path"
	value?: string;
	path?: string;
}

interface AssertionResult extends Assertion {
	passed: boolean;
}

interface EvaluatorResult {
	evaluator_id: string;
	source: "agentcore" | "in_house";
	value: number | null;
	label: string | null;
	explanation: string | null;
	token_usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
	error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueSessionId(runId: string, testCaseId: string | null, idx: number): string {
	return createHash("sha256")
		.update(`evalrun:${runId}:${testCaseId ?? "ad-hoc"}:${idx}:${Date.now()}`)
		.digest("hex")
		.slice(0, 64);
}

function evaluateAssertion(assertion: Assertion, output: string): boolean {
	switch (assertion.type) {
		case "contains":
			return Boolean(assertion.value && output.includes(assertion.value));
		case "icontains":
			return Boolean(assertion.value && output.toLowerCase().includes(assertion.value.toLowerCase()));
		case "not-contains":
			return Boolean(assertion.value && !output.includes(assertion.value));
		case "equals":
			return assertion.value === output.trim();
		case "regex":
			try { return Boolean(assertion.value && new RegExp(assertion.value).test(output)); }
			catch { return false; }
		default:
			return false;
	}
}

interface AgentTemplateConfig {
	model?: string | null;
	system_prompt?: string | null;
	skills?: unknown;
	knowledge_base_ids?: unknown;
}

async function invokeAgent(
	runtimeArn: string,
	sessionId: string,
	tenantId: string,
	assistantId: string,
	tenantSlug: string,
	prompt: string,
	systemPrompt: string | null,
	templateConfig?: AgentTemplateConfig | null,
): Promise<{ output: string; durationMs: number }> {
	const start = Date.now();
	const payload: Record<string, unknown> = {
		sessionId,
		message: prompt,
		assistant_id: assistantId,
		workspace_tenant_id: tenantId,
		tenant_slug: tenantSlug,
		use_memory: false,
	};
	// Apply agent-template overrides if the test case pinned one. The
	// per-test system_prompt argument wins if set; otherwise the template's
	// system_prompt does. Same precedence for model. Skills are passed
	// through as-is so the agent under test gets the template's exact tool
	// surface — this is what makes "the agent should refuse to web-search
	// because the template doesn't grant it" actually verifiable.
	//
	// Knowledge-base IDs and MCP/guardrail bindings are stored on the
	// template but require extra joins (KB configs, MCP gateway URLs,
	// guardrail ARNs). Wiring those into the payload is a follow-up; for
	// now the most load-bearing fields (model + system_prompt + skills)
	// are honored.
	if (templateConfig) {
		if (templateConfig.model) payload.model = templateConfig.model;
		if (templateConfig.skills) payload.skills = templateConfig.skills;
		if (!systemPrompt && templateConfig.system_prompt) payload.system_prompt = templateConfig.system_prompt;
	}
	if (systemPrompt) payload.system_prompt = systemPrompt;
	const resp = await ac.send(
		new InvokeAgentRuntimeCommand({
			agentRuntimeArn: runtimeArn,
			runtimeSessionId: sessionId,
			payload: JSON.stringify(payload),
		}),
	);
	const bytes = await resp.response!.transformToByteArray();
	const text = new TextDecoder().decode(bytes);
	const parsed = JSON.parse(text);
	const output = parsed.choices?.[0]?.message?.content ?? "";
	return { output: typeof output === "string" ? output : JSON.stringify(output), durationMs: Date.now() - start };
}

async function fetchSpansForSession(sessionId: string, runtimeLogGroup: string): Promise<unknown[]> {
	const startTime = Date.now() - 60 * 60 * 1000;
	const filterPattern = `"${sessionId}"`;
	const [spansResp, logsResp] = await Promise.all([
		cw.send(new FilterLogEventsCommand({ logGroupName: SPANS_LOG_GROUP, startTime, filterPattern, limit: 200 })),
		cw.send(new FilterLogEventsCommand({ logGroupName: runtimeLogGroup, startTime, filterPattern, limit: 200 })),
	]);
	const spans = (spansResp.events || []).map((e) => JSON.parse(e.message!));
	const logs = (logsResp.events || [])
		.map((e) => {
			try { return JSON.parse(e.message!); } catch { return null; }
		})
		.filter((r): r is { scope?: { name?: string }; spanId?: string } =>
			r !== null && r.scope?.name === "strands.telemetry.tracer" && Boolean(r.spanId),
		);
	return [...spans, ...logs];
}

async function waitForSpans(sessionId: string, runtimeLogGroup: string, expectedSpanName = "invoke_agent"): Promise<unknown[]> {
	const start = Date.now();
	await new Promise((r) => setTimeout(r, SPAN_WAIT_INITIAL_MS));
	while (Date.now() - start < SPAN_WAIT_MAX_MS) {
		const data = await fetchSpansForSession(sessionId, runtimeLogGroup);
		const hasInvokeAgent = data.some((d) => typeof (d as { name?: string }).name === "string" && (d as { name?: string }).name!.includes(expectedSpanName));
		if (hasInvokeAgent) return data;
		await new Promise((r) => setTimeout(r, SPAN_WAIT_INTERVAL_MS));
	}
	// Return whatever we have even if invoke_agent span not found.
	return await fetchSpansForSession(sessionId, runtimeLogGroup);
}

async function callEvaluator(evaluatorId: string, sessionSpans: unknown[]): Promise<EvaluatorResult> {
	try {
		const resp = await ac.send(
			new EvaluateCommand({
				evaluatorId,
				// SDK's TypeScript shape doesn't expose sessionSpans as `any[]`,
				// but the wire schema accepts arbitrary OTel JSON documents.
				// Cast through `unknown` to bypass the SDK's overly strict typing.
				evaluationInput: { sessionSpans } as unknown as never,
			}),
		);
		const r = resp.evaluationResults?.[0];
		if (!r) return { evaluator_id: evaluatorId, source: "agentcore", value: null, label: null, explanation: null, error: "no result returned" };
		if (r.errorMessage) return { evaluator_id: evaluatorId, source: "agentcore", value: null, label: null, explanation: null, error: r.errorMessage };
		return {
			evaluator_id: evaluatorId,
			source: "agentcore",
			value: typeof r.value === "number" ? r.value : null,
			label: r.label ?? null,
			explanation: r.explanation ?? null,
			token_usage: r.tokenUsage,
		};
	} catch (err) {
		return { evaluator_id: evaluatorId, source: "agentcore", value: null, label: null, explanation: null, error: err instanceof Error ? err.message : String(err) };
	}
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: EvalRunnerEvent): Promise<{ ok: boolean; runId: string; error?: string }> {
	const { runId } = event;
	if (!runId) return { ok: false, runId: "", error: "missing runId" };

	const db = getDb();
	const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
	if (!run) return { ok: false, runId, error: "run not found" };

	console.log(`[eval-runner] starting runId=${runId} tenant=${run.tenant_id} agent=${run.agent_id}`);

	// Load test cases for this tenant. Filter by category if the run scoped them.
	const cases = await db
		.select()
		.from(evalTestCases)
		.where(and(
			eq(evalTestCases.tenant_id, run.tenant_id),
			eq(evalTestCases.enabled, true),
			run.categories.length > 0
				? inArray(evalTestCases.category, run.categories)
				: sql`true`,
		));

	const runtimeId = await loadRuntimeId();
	const runtimeArn = `arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${runtimeId}`;
	const runtimeLogGroup = `${RUNTIME_LOG_GROUP_PREFIX}${runtimeId}-DEFAULT`;

	// Mark running.
	const startedAt = new Date();
	await db.update(evalRuns).set({ status: "running", started_at: startedAt, total_tests: cases.length }).where(eq(evalRuns.id, runId));
	await notifyEvalRunUpdate({ runId, tenantId: run.tenant_id, agentId: run.agent_id, status: "running", totalTests: cases.length });

	// Run tests with bounded concurrency so the Lambda doesn't hit its 900s
	// timeout on larger packs. Each test is independent: own session ID, own
	// DB insert; the only shared state is the aggregate counters below, which
	// we accumulate once every batch resolves.
	const CONCURRENCY = 5;

	async function runOneTest(tc: typeof cases[number], i: number): Promise<{ passed: boolean; costUsd: number }> {
		const sessionId = uniqueSessionId(runId, tc.id, i);
		console.log(`[eval-runner] test ${i + 1}/${cases.length} '${tc.name}' session=${sessionId.slice(0, 12)}`);

		let actualOutput = "";
		let durationMs = 0;
		let errorMessage: string | null = null;
		const assertionResults: AssertionResult[] = [];
		const evaluatorResults: EvaluatorResult[] = [];
		let costUsd = 0;

		try {
			// Resolve which template config to load. Test-case-level pin
			// wins over run-level. If neither is set, no template config
			// is applied and the runtime uses its built-in defaults.
			const templateId = tc.agent_template_id ?? run.agent_template_id ?? null;
			let templateConfig: AgentTemplateConfig | null = null;
			if (templateId) {
				const [tpl] = await db
					.select({
						model: agentTemplates.model,
						config: agentTemplates.config,
						skills: agentTemplates.skills,
					})
					.from(agentTemplates)
					.where(eq(agentTemplates.id, templateId));
				if (tpl) {
					const cfg = (tpl.config ?? {}) as { system_prompt?: string };
					templateConfig = {
						model: tpl.model,
						system_prompt: cfg.system_prompt ?? null,
						skills: tpl.skills,
					};
				}
			}
			const inv = await invokeAgent(
				runtimeArn,
				sessionId,
				run.tenant_id,
				run.agent_id ?? "eval-test-agent",
				"dev",
				tc.query,
				tc.system_prompt,
				templateConfig,
			);
			actualOutput = inv.output;
			durationMs = inv.durationMs;

			// Deterministic assertions — evaluated locally (the v1 plan's "in-house" path).
			const assertions = (tc.assertions ?? []) as Assertion[];
			for (const a of assertions) {
				assertionResults.push({ ...a, passed: evaluateAssertion(a, actualOutput) });
			}

			// AgentCore evaluators — wait for spans, then call Evaluate per evaluator.
			const evaluatorIds = (tc.agentcore_evaluator_ids ?? []) as string[];
			if (evaluatorIds.length > 0) {
				const sessionSpans = await waitForSpans(sessionId, runtimeLogGroup);
				for (const evaluatorId of evaluatorIds) {
					const result = await callEvaluator(evaluatorId, sessionSpans);
					evaluatorResults.push(result);
					const tu = result.token_usage;
					if (tu?.totalTokens) costUsd += (tu.totalTokens / 1000) * 0.012;
				}
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : String(err);
			console.error(`[eval-runner] test '${tc.name}' failed:`, errorMessage);
		}

		const assertionsPassed = assertionResults.every((a) => a.passed);
		const evaluatorsPassed = evaluatorResults.every((r) => typeof r.value === "number" && r.value >= PASS_THRESHOLD);
		const score = evaluatorResults.length > 0
			? evaluatorResults
				.filter((r) => typeof r.value === "number")
				.reduce((acc, r, _, arr) => acc + (r.value as number) / arr.length, 0)
			: assertionsPassed ? 1 : 0;
		const status = errorMessage ? "error" : (assertionsPassed && evaluatorsPassed ? "pass" : "fail");

		await db.insert(evalResults).values({
			run_id: runId,
			test_case_id: tc.id,
			status,
			score: typeof score === "number" ? score.toFixed(4) : null,
			duration_ms: durationMs,
			agent_session_id: sessionId,
			input: tc.query,
			expected: null,
			actual_output: actualOutput,
			evaluator_results: evaluatorResults,
			assertions: assertionResults,
			error_message: errorMessage,
		});

		return { passed: status === "pass", costUsd };
	}

	let passed = 0;
	let failed = 0;
	let totalCostUsd = 0;

	for (let offset = 0; offset < cases.length; offset += CONCURRENCY) {
		const batch = cases.slice(offset, offset + CONCURRENCY);
		const results = await Promise.all(batch.map((tc, j) => runOneTest(tc, offset + j)));
		for (const r of results) {
			if (r.passed) passed++; else failed++;
			totalCostUsd += r.costUsd;
		}
	}

	// Aggregate.
	const completedAt = new Date();
	const passRate = cases.length > 0 ? passed / cases.length : 0;
	await db.update(evalRuns).set({
		status: "completed",
		completed_at: completedAt,
		passed,
		failed,
		pass_rate: passRate.toFixed(4),
		cost_usd: totalCostUsd.toFixed(6),
	}).where(eq(evalRuns.id, runId));

	if (totalCostUsd > 0 && run.agent_id) {
		await db.insert(costEvents).values({
			tenant_id: run.tenant_id,
			agent_id: run.agent_id,
			request_id: `eval-run-${runId}`,
			event_type: "eval_compute",
			amount_usd: totalCostUsd.toFixed(6),
			metadata: { source: "eval-runner", run_id: runId, total_tests: cases.length },
		}).onConflictDoNothing();
	}

	await notifyEvalRunUpdate({
		runId, tenantId: run.tenant_id, agentId: run.agent_id,
		status: "completed", totalTests: cases.length, passed, failed, passRate,
	});

	console.log(`[eval-runner] runId=${runId} done: ${passed}/${cases.length} passed (${(passRate * 100).toFixed(1)}%) cost=$${totalCostUsd.toFixed(4)}`);
	return { ok: true, runId };
}
