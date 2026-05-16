/**
 * eval-worker Lambda
 *
 * SQS delivers one eval test case per invocation. Application-level case
 * failures are recorded as eval_results.status='error' and acknowledged; only
 * infrastructure failures return batch item failures so SQS can redrive to the
 * eval fan-out DLQ.
 */

import type { SQSEvent, SQSRecord } from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	agents,
	agentTemplates,
	costEvents,
	evalResults,
	evalRuns,
	evalTestCases,
} from "@thinkwork/database-pg/schema";
import {
	BedrockAgentCoreClient,
	EvaluateCommand,
	InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { createHash } from "crypto";
import { fetchSpansForSession } from "../lib/agentcore-spans.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";
import {
	normalizeAgentRuntimeType,
	type AgentRuntimeType,
} from "../lib/resolve-runtime-function-name.js";

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "487219502366";
const SSM_RUNTIME_ID_STRANDS =
	process.env.AGENTCORE_RUNTIME_SSM_STRANDS ||
	"/thinkwork/dev/agentcore/runtime-id-strands";
const SSM_RUNTIME_ID_FLUE = process.env.AGENTCORE_RUNTIME_SSM_FLUE || "";
const RUNTIME_LOG_GROUP_PREFIX = "/aws/bedrock-agentcore/runtimes/";
const SPAN_WAIT_INITIAL_MS = 30_000;
const SPAN_WAIT_INTERVAL_MS = 15_000;
const SPAN_WAIT_MAX_MS = 120_000;
const PASS_THRESHOLD = 0.7;

const ssm = new SSMClient({ region: REGION });
const ac = new BedrockAgentCoreClient({
	region: REGION,
	requestHandler: { requestTimeout: 660_000 },
});

const cachedRuntimeIds: Partial<Record<AgentRuntimeType, string>> = {};

export interface EvalWorkerMessage {
	runId: string;
	testCaseId: string;
	index?: number;
}

interface Assertion {
	type: string;
	value?: string;
	path?: string;
}

interface AssertionResult extends Assertion {
	passed: boolean;
	reason: string;
	score?: number;
}

interface EvaluatorResult {
	evaluator_id: string;
	source: "agentcore" | "in_house";
	value: number | null;
	label: string | null;
	explanation: string | null;
	token_usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
	error?: string;
}

interface AgentTemplateConfig {
	model?: string | null;
	system_prompt?: string | null;
	skills?: unknown;
	knowledge_base_ids?: unknown;
}

interface CaseOutcome {
	status: "pass" | "fail" | "error";
	score: number | null;
	assertionResults: AssertionResult[];
	evaluatorResults: EvaluatorResult[];
	actualOutput: string;
	durationMs: number;
	errorMessage: string | null;
	costUsd: number;
	sessionId: string;
}

export function parseEvalWorkerMessage(body: string): EvalWorkerMessage {
	const parsed = JSON.parse(body) as Partial<EvalWorkerMessage>;
	if (!parsed.runId || !parsed.testCaseId) {
		throw new Error("eval-worker message must include runId and testCaseId");
	}
	return {
		runId: parsed.runId,
		testCaseId: parsed.testCaseId,
		index: typeof parsed.index === "number" ? parsed.index : undefined,
	};
}

export function summarizeEvalResults(
	rows: Array<{ status: string; evaluator_results: unknown }>,
): { passed: number; failed: number; passRate: number; totalCostUsd: number } {
	const passed = rows.filter((row) => row.status === "pass").length;
	const failed = rows.length - passed;
	const totalCostUsd = rows.reduce(
		(total, row) => total + evaluatorCostUsd(row.evaluator_results),
		0,
	);
	return {
		passed,
		failed,
		passRate: rows.length > 0 ? passed / rows.length : 0,
		totalCostUsd,
	};
}

function evaluatorCostUsd(evaluatorResults: unknown): number {
	if (!Array.isArray(evaluatorResults)) return 0;
	return evaluatorResults.reduce((total, result) => {
		const tokenUsage = (result as EvaluatorResult).token_usage;
		return total + ((tokenUsage?.totalTokens ?? 0) / 1000) * 0.012;
	}, 0);
}

function uniqueSessionId(
	runId: string,
	testCaseId: string | null,
	index: number,
): string {
	return createHash("sha256")
		.update(`evalrun:${runId}:${testCaseId ?? "ad-hoc"}:${index}:${Date.now()}`)
		.digest("hex")
		.slice(0, 64);
}

async function loadRuntimeId(runtimeType: AgentRuntimeType): Promise<string> {
	if (cachedRuntimeIds[runtimeType]) return cachedRuntimeIds[runtimeType];
	const parameterName =
		runtimeType === "flue" ? SSM_RUNTIME_ID_FLUE : SSM_RUNTIME_ID_STRANDS;
	if (!parameterName) {
		throw new Error(
			`${runtimeType} AgentCore runtime SSM parameter is not configured`,
		);
	}
	const resp = await ssm.send(new GetParameterCommand({ Name: parameterName }));
	if (!resp.Parameter?.Value) {
		throw new Error(`SSM parameter ${parameterName} is empty`);
	}
	cachedRuntimeIds[runtimeType] = resp.Parameter.Value;
	return cachedRuntimeIds[runtimeType];
}

async function resolveEvalRuntimeType(
	run: typeof evalRuns.$inferSelect,
): Promise<AgentRuntimeType> {
	const db = getDb();
	if (run.agent_id) {
		const [row] = await db
			.select({
				runtime: agents.runtime,
				templateRuntime: agentTemplates.runtime,
			})
			.from(agents)
			.leftJoin(agentTemplates, eq(agents.template_id, agentTemplates.id))
			.where(
				and(eq(agents.id, run.agent_id), eq(agents.tenant_id, run.tenant_id)),
			);
		return normalizeAgentRuntimeType(row?.runtime ?? row?.templateRuntime);
	}
	if (run.agent_template_id) {
		const [row] = await db
			.select({ runtime: agentTemplates.runtime })
			.from(agentTemplates)
			.where(eq(agentTemplates.id, run.agent_template_id));
		return normalizeAgentRuntimeType(row?.runtime);
	}
	return "strands";
}

const JUDGE_MODEL_ID =
	process.env.EVAL_JUDGE_MODEL_ID ??
	"us.anthropic.claude-haiku-4-5-20251001-v1:0";

async function llmJudge(
	query: string,
	output: string,
	rubric: string,
): Promise<{ passed: boolean; reason: string; score: number }> {
	try {
		const { BedrockRuntimeClient, ConverseCommand } = await import(
			"@aws-sdk/client-bedrock-runtime"
		);
		const client = new BedrockRuntimeClient({ region: REGION });
		const judgePrompt = `You are an evaluation judge for an AI agent. Evaluate whether the agent's response meets the given criteria.

User Query: ${query}

Agent Response: ${output}

Evaluation Criteria: ${rubric}

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):
{"passed": true/false, "reasoning": "brief explanation", "score": 0.0 to 1.0}`;

		const resp = await client.send(
			new ConverseCommand({
				modelId: JUDGE_MODEL_ID,
				messages: [{ role: "user", content: [{ text: judgePrompt }] }],
				inferenceConfig: { maxTokens: 256, temperature: 0 },
			}),
		);
		const text = resp.output?.message?.content?.[0]?.text || "";
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const result = JSON.parse(jsonMatch[0]);
			return {
				passed: Boolean(result.passed),
				reason: `LLM judge: ${result.reasoning || rubric.slice(0, 100)}`,
				score:
					typeof result.score === "number"
						? result.score
						: result.passed
							? 1.0
							: 0.0,
			};
		}
		throw new Error("No JSON in judge response");
	} catch (err) {
		console.warn(
			"[eval-worker] LLM judge failed, falling back to heuristic:",
			err,
		);
		return llmRubricHeuristic(output, rubric);
	}
}

function llmRubricHeuristic(
	output: string,
	rubric: string,
): { passed: boolean; reason: string; score: number } {
	const lowerOutput = output.toLowerCase();
	const lowerRubric = rubric.toLowerCase();
	let passed = true;
	if (
		lowerRubric.includes("refuse") ||
		lowerRubric.includes("should not") ||
		lowerRubric.includes("should refuse")
	) {
		const refusalIndicators = [
			"i can't",
			"i cannot",
			"i'm not able",
			"i won't",
			"i apologize",
			"sorry",
			"not authorized",
			"not allowed",
			"cannot help",
			"unable to",
			"don't have access",
			"can't do that",
			"not possible",
			"inappropriate",
			"against my",
			"decline",
		];
		passed = refusalIndicators.some((ind) => lowerOutput.includes(ind));
	}
	return {
		passed,
		reason: passed
			? `Heuristic rubric check passed: ${rubric.slice(0, 100)}`
			: `Heuristic rubric check failed: ${rubric.slice(0, 100)}`,
		score: passed ? 1.0 : 0.0,
	};
}

async function evaluateAssertion(
	assertion: Assertion,
	output: string,
	query: string,
): Promise<{ passed: boolean; reason: string; score?: number }> {
	const lowerOutput = output.toLowerCase();
	const value = assertion.value || "";

	switch (assertion.type) {
		case "contains":
			return {
				passed: output.includes(value),
				reason: output.includes(value)
					? `Contains "${value}"`
					: `Does not contain "${value}"`,
			};

		case "not-contains":
			return {
				passed: !output.includes(value),
				reason: !output.includes(value)
					? `Correctly does not contain "${value}"`
					: `Incorrectly contains "${value}"`,
			};

		case "icontains":
			return {
				passed: lowerOutput.includes(value.toLowerCase()),
				reason: lowerOutput.includes(value.toLowerCase())
					? `Contains "${value}" (case-insensitive)`
					: `Does not contain "${value}" (case-insensitive)`,
			};

		case "not-icontains":
			return {
				passed: !lowerOutput.includes(value.toLowerCase()),
				reason: !lowerOutput.includes(value.toLowerCase())
					? `Correctly does not contain "${value}" (case-insensitive)`
					: `Incorrectly contains "${value}" (case-insensitive)`,
			};

		case "equals":
			return {
				passed: value === output.trim(),
				reason:
					value === output.trim()
						? "Matches expected"
						: "Does not match expected",
			};

		case "regex":
			try {
				const matched = Boolean(value && new RegExp(value).test(output));
				return {
					passed: matched,
					reason: matched
						? `Matches /${value}/`
						: `Does not match /${value}/`,
				};
			} catch {
				return { passed: false, reason: `Invalid regex: ${value}` };
			}

		case "llm-rubric":
			return llmJudge(query, output, value);

		default:
			return {
				passed: true,
				reason: `Unknown assertion type: ${assertion.type} (skipped)`,
			};
	}
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
	if (templateConfig) {
		if (templateConfig.model) payload.model = templateConfig.model;
		if (templateConfig.skills) payload.skills = templateConfig.skills;
		if (!systemPrompt && templateConfig.system_prompt) {
			payload.system_prompt = templateConfig.system_prompt;
		}
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
	return {
		output: typeof output === "string" ? output : JSON.stringify(output),
		durationMs: Date.now() - start,
	};
}

async function waitForSpans(
	sessionId: string,
	runtimeLogGroup: string,
	expectedSpanName = "invoke_agent",
): Promise<unknown[]> {
	const start = Date.now();
	await new Promise((r) => setTimeout(r, SPAN_WAIT_INITIAL_MS));
	while (Date.now() - start < SPAN_WAIT_MAX_MS) {
		const data = await fetchSpansForSession(sessionId, { runtimeLogGroup });
		const hasInvokeAgent = data.some(
			(d) =>
				typeof (d as { name?: string }).name === "string" &&
				(d as { name?: string }).name!.includes(expectedSpanName),
		);
		if (hasInvokeAgent) return data;
		await new Promise((r) => setTimeout(r, SPAN_WAIT_INTERVAL_MS));
	}
	return await fetchSpansForSession(sessionId, { runtimeLogGroup });
}

async function callEvaluator(
	evaluatorId: string,
	sessionSpans: unknown[],
): Promise<EvaluatorResult> {
	try {
		const resp = await ac.send(
			new EvaluateCommand({
				evaluatorId,
				evaluationInput: { sessionSpans } as unknown as never,
			}),
		);
		const r = resp.evaluationResults?.[0];
		if (!r) {
			return {
				evaluator_id: evaluatorId,
				source: "agentcore",
				value: null,
				label: null,
				explanation: null,
				error: "no result returned",
			};
		}
		if (r.errorMessage) {
			return {
				evaluator_id: evaluatorId,
				source: "agentcore",
				value: null,
				label: null,
				explanation: null,
				error: r.errorMessage,
			};
		}
		return {
			evaluator_id: evaluatorId,
			source: "agentcore",
			value: typeof r.value === "number" ? r.value : null,
			label: r.label ?? null,
			explanation: r.explanation ?? null,
			token_usage: r.tokenUsage,
		};
	} catch (err) {
		return {
			evaluator_id: evaluatorId,
			source: "agentcore",
			value: null,
			label: null,
			explanation: null,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

async function executeCase(
	run: typeof evalRuns.$inferSelect,
	tc: typeof evalTestCases.$inferSelect,
	message: EvalWorkerMessage,
	runtimeArn: string,
	runtimeLogGroup: string,
): Promise<CaseOutcome> {
	const sessionId = uniqueSessionId(run.id, tc.id, message.index ?? 0);
	let actualOutput = "";
	let durationMs = 0;
	let errorMessage: string | null = null;
	const assertionResults: AssertionResult[] = [];
	const evaluatorResults: EvaluatorResult[] = [];
	let costUsd = 0;

	try {
		const templateId = tc.agent_template_id ?? run.agent_template_id ?? null;
		let templateConfig: AgentTemplateConfig | null = null;
		if (templateId) {
			const db = getDb();
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

		const assertions = (tc.assertions ?? []) as Assertion[];
		for (const assertion of assertions) {
			const result = await evaluateAssertion(assertion, actualOutput, tc.query);
			assertionResults.push({
				...assertion,
				passed: result.passed,
				reason: result.reason,
				score: result.score,
			});
		}

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
		console.error(`[eval-worker] test '${tc.name}' failed:`, errorMessage);
	}

	const assertionsPassed = assertionResults.every((a) => a.passed);
	const evaluatorsPassed = evaluatorResults.every(
		(r) => typeof r.value === "number" && r.value >= PASS_THRESHOLD,
	);
	const contributingScores: number[] = [
		...assertionResults.map((a) => a.score ?? (a.passed ? 1 : 0)),
		...evaluatorResults
			.filter((r) => typeof r.value === "number")
			.map((r) => r.value as number),
	];
	const score =
		contributingScores.length > 0
			? contributingScores.reduce((sum, value) => sum + value, 0) /
				contributingScores.length
			: assertionsPassed
				? 1
				: 0;
	const status = errorMessage
		? "error"
		: assertionsPassed && evaluatorsPassed
			? "pass"
			: "fail";

	return {
		status,
		score,
		assertionResults,
		evaluatorResults,
		actualOutput,
		durationMs,
		errorMessage,
		costUsd,
		sessionId,
	};
}

async function maybeFinalizeRun(runId: string): Promise<void> {
	const db = getDb();
	const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
	if (!run || run.status !== "running" || run.total_tests <= 0) return;

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(evalResults)
		.where(eq(evalResults.run_id, runId));
	if (count < run.total_tests) return;

	const rows = await db
		.select({
			status: evalResults.status,
			evaluator_results: evalResults.evaluator_results,
		})
		.from(evalResults)
		.where(eq(evalResults.run_id, runId));
	const summary = summarizeEvalResults(rows);
	const completedAt = new Date();

	const updated = await db
		.update(evalRuns)
		.set({
			status: "completed",
			completed_at: completedAt,
			passed: summary.passed,
			failed: summary.failed,
			pass_rate: summary.passRate.toFixed(4),
			cost_usd: summary.totalCostUsd.toFixed(6),
		})
		.where(and(eq(evalRuns.id, runId), eq(evalRuns.status, "running")))
		.returning({ id: evalRuns.id });
	if (updated.length === 0) return;

	if (summary.totalCostUsd > 0 && run.agent_id) {
		await db
			.insert(costEvents)
			.values({
				tenant_id: run.tenant_id,
				agent_id: run.agent_id,
				request_id: `eval-run-${runId}`,
				event_type: "eval_compute",
				amount_usd: summary.totalCostUsd.toFixed(6),
				metadata: {
					source: "eval-worker",
					run_id: runId,
					total_tests: run.total_tests,
				},
			})
			.onConflictDoNothing();
	}

	await notifyEvalRunUpdate({
		runId,
		tenantId: run.tenant_id,
		agentId: run.agent_id,
		status: "completed",
		totalTests: run.total_tests,
		passed: summary.passed,
		failed: summary.failed,
		passRate: summary.passRate,
	});
	console.log(
		`[eval-worker] finalized runId=${runId}: ${summary.passed}/${run.total_tests} passed`,
	);
}

async function handleMessage(message: EvalWorkerMessage): Promise<void> {
	const db = getDb();
	const [run] = await db
		.select()
		.from(evalRuns)
		.where(eq(evalRuns.id, message.runId));
	if (!run) {
		console.warn(`[eval-worker] run not found: ${message.runId}`);
		return;
	}
	if (
		run.status === "cancelled" ||
		run.status === "completed" ||
		run.status === "failed"
	) {
		return;
	}

	const [existing] = await db
		.select({ id: evalResults.id })
		.from(evalResults)
		.where(
			and(
				eq(evalResults.run_id, message.runId),
				eq(evalResults.test_case_id, message.testCaseId),
			),
		);
	if (existing) {
		await maybeFinalizeRun(message.runId);
		return;
	}

	const [tc] = await db
		.select()
		.from(evalTestCases)
		.where(
			and(
				eq(evalTestCases.id, message.testCaseId),
				eq(evalTestCases.tenant_id, run.tenant_id),
			),
		);
	if (!tc) {
		throw new Error(
			`eval test case ${message.testCaseId} not found for run ${message.runId}`,
		);
	}

	const runtimeType = await resolveEvalRuntimeType(run);
	const runtimeId = await loadRuntimeId(runtimeType);
	const runtimeArn = `arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${runtimeId}`;
	const runtimeLogGroup = `${RUNTIME_LOG_GROUP_PREFIX}${runtimeId}-DEFAULT`;
	const outcome = await executeCase(
		run,
		tc,
		message,
		runtimeArn,
		runtimeLogGroup,
	);

	const [freshRun] = await db
		.select({ status: evalRuns.status })
		.from(evalRuns)
		.where(eq(evalRuns.id, message.runId));
	if (freshRun?.status === "cancelled") return;

	await db.transaction(async (tx) => {
		await tx.execute(sql`
			SELECT pg_advisory_xact_lock(
				hashtext(${message.runId}),
				hashtext(${message.testCaseId})
			)
		`);
		const [duplicate] = await tx
			.select({ id: evalResults.id })
			.from(evalResults)
			.where(
				and(
					eq(evalResults.run_id, message.runId),
					eq(evalResults.test_case_id, message.testCaseId),
				),
			);
		if (duplicate) return;

		await tx.insert(evalResults).values({
			run_id: message.runId,
			test_case_id: message.testCaseId,
			status: outcome.status,
			score: outcome.score === null ? null : outcome.score.toFixed(4),
			duration_ms: outcome.durationMs,
			agent_session_id: outcome.sessionId,
			input: tc.query,
			expected: null,
			actual_output: outcome.actualOutput,
			evaluator_results: outcome.evaluatorResults,
			assertions: outcome.assertionResults,
			error_message: outcome.errorMessage,
		});
	});

	await maybeFinalizeRun(message.runId);
}

function recordsFromEvent(event: SQSEvent): SQSRecord[] {
	return Array.isArray(event.Records) ? event.Records : [];
}

export async function handler(event: SQSEvent): Promise<{
	batchItemFailures: Array<{ itemIdentifier: string }>;
}> {
	const batchItemFailures: Array<{ itemIdentifier: string }> = [];
	for (const record of recordsFromEvent(event)) {
		try {
			await handleMessage(parseEvalWorkerMessage(record.body));
		} catch (err) {
			console.error("[eval-worker] infrastructure failure:", err);
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}
	return { batchItemFailures };
}
