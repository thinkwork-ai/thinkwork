#!/usr/bin/env tsx
/**
 * Probe eval-runner per-case latency by stage before changing the runner
 * substrate. This intentionally mirrors the current eval-runner flow, but it
 * does not update eval_runs or persist eval_results.
 *
 * Usage:
 *   DATABASE_URL=... AWS_REGION=us-east-1 pnpm exec tsx scripts/eval-stall-probe.ts \
 *     --run-id <eval_run_uuid> --limit 10
 *
 * For the DB insert stage, pass --measure-db-write. The script measures an
 * eval_results insert inside a transaction and rolls it back immediately.
 */

import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	agentTemplates,
	agents,
	evalResults,
	evalRuns,
	evalTestCases,
} from "@thinkwork/database-pg/schema";
import {
	BedrockAgentCoreClient,
	EvaluateCommand,
	InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
	CloudWatchLogsClient,
	FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
	normalizeAgentRuntimeType,
	type AgentRuntimeType,
} from "../src/lib/resolve-runtime-function-name.js";

type EvalRun = typeof evalRuns.$inferSelect;
type EvalTestCase = typeof evalTestCases.$inferSelect;

interface CliArgs {
	runId: string | null;
	tenantId: string | null;
	categories: string[];
	testCaseIds: string[];
	limit: number | null;
	concurrency: number;
	invokeTimeoutMs: number;
	evaluatorTimeoutMs: number;
	measureDbWrite: boolean;
	json: boolean;
}

interface StageTiming {
	runId: string | null;
	testCaseId: string;
	testCaseName: string;
	category: string;
	sessionId: string;
	invokeMs: number | null;
	spanWaitMs: number | null;
	evaluatorMs: number | null;
	dbWriteMs: number | null;
	totalMs: number;
	evaluatorCount: number;
	spanCount: number;
	outputBytes: number;
	error: string | null;
}

interface AgentTemplateConfig {
	model?: string | null;
	system_prompt?: string | null;
	skills?: unknown;
}

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "487219502366";
const SSM_RUNTIME_ID_STRANDS =
	process.env.AGENTCORE_RUNTIME_SSM_STRANDS ||
	"/thinkwork/dev/agentcore/runtime-id-strands";
const SSM_RUNTIME_ID_FLUE = process.env.AGENTCORE_RUNTIME_SSM_FLUE || "";
const SPANS_LOG_GROUP = process.env.SPANS_LOG_GROUP || "aws/spans";
const RUNTIME_LOG_GROUP_PREFIX = "/aws/bedrock-agentcore/runtimes/";
const SPAN_WAIT_INITIAL_MS = Number(process.env.SPAN_WAIT_INITIAL_MS ?? 30_000);
const SPAN_WAIT_INTERVAL_MS = Number(process.env.SPAN_WAIT_INTERVAL_MS ?? 15_000);
const SPAN_WAIT_MAX_MS = Number(process.env.SPAN_WAIT_MAX_MS ?? 120_000);

const ssm = new SSMClient({ region: REGION });
const agentCore = new BedrockAgentCoreClient({
	region: REGION,
	requestHandler: { requestTimeout: 660_000 },
});
const cloudWatch = new CloudWatchLogsClient({ region: REGION });
const runtimeIds: Partial<Record<AgentRuntimeType, string>> = {};

function usage(exitCode = 1): never {
	const stream = exitCode === 0 ? console.log : console.error;
	stream(`Usage:
  pnpm exec tsx scripts/eval-stall-probe.ts --run-id <uuid> [options]

Options:
  --tenant-id <uuid>          Probe tenant enabled cases without an eval_runs row.
  --category <name>           Category filter. Repeatable.
  --test-case-id <uuid>       Test-case filter. Repeatable.
  --limit <n>                 Limit selected cases.
  --concurrency <n>           Probe concurrency. Defaults to 5, matching current runner.
  --invoke-timeout-ms <n>     Abort one AgentCore invoke after n ms. Defaults to 660000.
  --evaluator-timeout-ms <n>  Abort one evaluator call after n ms. Defaults to 180000.
  --measure-db-write          Measure eval_results insert inside a rolled-back transaction.
  --json                      Print JSON instead of markdown summary.
`);
	process.exit(exitCode);
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		runId: null,
		tenantId: null,
		categories: [],
		testCaseIds: [],
		limit: null,
		concurrency: 5,
		invokeTimeoutMs: 660_000,
		evaluatorTimeoutMs: 180_000,
		measureDbWrite: false,
		json: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = () => {
			const value = argv[i + 1];
			if (!value || value.startsWith("--")) usage();
			i += 1;
			return value;
		};
		switch (arg) {
			case "--run-id":
				args.runId = next();
				break;
			case "--tenant-id":
				args.tenantId = next();
				break;
			case "--category":
			case "--categories":
				args.categories.push(
					...next()
						.split(",")
						.map((v) => v.trim())
						.filter(Boolean),
				);
				break;
			case "--test-case-id":
			case "--test-case-ids":
				args.testCaseIds.push(
					...next()
						.split(",")
						.map((v) => v.trim())
						.filter(Boolean),
				);
				break;
			case "--limit":
				args.limit = Number(next());
				break;
			case "--concurrency":
				args.concurrency = Number(next());
				break;
			case "--invoke-timeout-ms":
				args.invokeTimeoutMs = Number(next());
				break;
			case "--evaluator-timeout-ms":
				args.evaluatorTimeoutMs = Number(next());
				break;
			case "--measure-db-write":
				args.measureDbWrite = true;
				break;
			case "--json":
				args.json = true;
				break;
			case "--help":
			case "-h":
				usage(0);
				break;
			default:
				console.error(`Unknown argument: ${arg}`);
				usage();
		}
	}

	if (!args.runId && !args.tenantId) usage();
	if (!Number.isInteger(args.concurrency) || args.concurrency < 1) usage();
	if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
		usage();
	}
	if (!Number.isInteger(args.invokeTimeoutMs) || args.invokeTimeoutMs < 1) usage();
	if (!Number.isInteger(args.evaluatorTimeoutMs) || args.evaluatorTimeoutMs < 1) {
		usage();
	}
	return args;
}

function uniqueSessionId(runId: string | null, testCaseId: string, idx: number) {
	return createHash("sha256")
		.update(`eval-stall-probe:${runId ?? "no-run"}:${testCaseId}:${idx}:${Date.now()}`)
		.digest("hex")
		.slice(0, 64);
}

async function timed<T>(fn: () => Promise<T>) {
	const start = performance.now();
	const value = await fn();
	return { value, ms: performance.now() - start };
}

async function loadRuntimeId(runtimeType: AgentRuntimeType) {
	if (runtimeIds[runtimeType]) return runtimeIds[runtimeType]!;
	const parameterName =
		runtimeType === "flue" ? SSM_RUNTIME_ID_FLUE : SSM_RUNTIME_ID_STRANDS;
	if (!parameterName) {
		throw new Error(`${runtimeType} AgentCore runtime SSM parameter is not configured`);
	}
	const resp = await ssm.send(new GetParameterCommand({ Name: parameterName }));
	if (!resp.Parameter?.Value) throw new Error(`SSM parameter ${parameterName} is empty`);
	runtimeIds[runtimeType] = resp.Parameter.Value;
	return resp.Parameter.Value;
}

async function resolveRuntimeType(run: EvalRun | null, tenantId: string) {
	const db = getDb();
	if (run?.agent_id) {
		const [row] = await db
			.select({
				runtime: agents.runtime,
				templateRuntime: agentTemplates.runtime,
			})
			.from(agents)
			.leftJoin(agentTemplates, eq(agents.template_id, agentTemplates.id))
			.where(and(eq(agents.id, run.agent_id), eq(agents.tenant_id, tenantId)));
		return normalizeAgentRuntimeType(row?.runtime ?? row?.templateRuntime);
	}
	if (run?.agent_template_id) {
		const [row] = await db
			.select({ runtime: agentTemplates.runtime })
			.from(agentTemplates)
			.where(eq(agentTemplates.id, run.agent_template_id));
		return normalizeAgentRuntimeType(row?.runtime);
	}
	return "strands";
}

async function loadCases(args: CliArgs, run: EvalRun | null) {
	const db = getDb();
	const tenantId = run?.tenant_id ?? args.tenantId;
	if (!tenantId) throw new Error("Missing tenant id");

	const categories = args.categories.length > 0 ? args.categories : run?.categories ?? [];
	const conditions = [
		eq(evalTestCases.tenant_id, tenantId),
		eq(evalTestCases.enabled, true),
	];
	if (args.testCaseIds.length > 0) {
		conditions.push(inArray(evalTestCases.id, args.testCaseIds));
	} else if (categories.length > 0) {
		conditions.push(inArray(evalTestCases.category, categories));
	}

	const selected = await db
		.select()
		.from(evalTestCases)
		.where(and(...conditions));
	return args.limit ? selected.slice(0, args.limit) : selected;
}

async function loadTemplateConfig(
	testCase: EvalTestCase,
	run: EvalRun | null,
): Promise<AgentTemplateConfig | null> {
	const templateId = testCase.agent_template_id ?? run?.agent_template_id ?? null;
	if (!templateId) return null;
	const db = getDb();
	const [tpl] = await db
		.select({
			model: agentTemplates.model,
			config: agentTemplates.config,
			skills: agentTemplates.skills,
		})
		.from(agentTemplates)
		.where(eq(agentTemplates.id, templateId));
	if (!tpl) return null;
	const cfg = (tpl.config ?? {}) as { system_prompt?: string };
	return {
		model: tpl.model,
		system_prompt: cfg.system_prompt ?? null,
		skills: tpl.skills,
	};
}

async function invokeAgent(params: {
	runtimeArn: string;
	sessionId: string;
	tenantId: string;
	assistantId: string;
	prompt: string;
	systemPrompt: string | null;
	templateConfig: AgentTemplateConfig | null;
	timeoutMs: number;
}) {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), params.timeoutMs);
	const payload: Record<string, unknown> = {
		sessionId: params.sessionId,
		message: params.prompt,
		assistant_id: params.assistantId,
		workspace_tenant_id: params.tenantId,
		tenant_slug: "dev",
		use_memory: false,
	};
	if (params.templateConfig) {
		if (params.templateConfig.model) payload.model = params.templateConfig.model;
		if (params.templateConfig.skills) payload.skills = params.templateConfig.skills;
		if (!params.systemPrompt && params.templateConfig.system_prompt) {
			payload.system_prompt = params.templateConfig.system_prompt;
		}
	}
	if (params.systemPrompt) payload.system_prompt = params.systemPrompt;

	try {
		const response = await agentCore.send(
			new InvokeAgentRuntimeCommand({
				agentRuntimeArn: params.runtimeArn,
				runtimeSessionId: params.sessionId,
				payload: JSON.stringify(payload),
			}),
			{ abortSignal: abortController.signal },
		);
		const bytes = await response.response!.transformToByteArray();
		const text = new TextDecoder().decode(bytes);
		const parsed = JSON.parse(text);
		const output = parsed.choices?.[0]?.message?.content ?? "";
		return typeof output === "string" ? output : JSON.stringify(output);
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchSpansForSession(sessionId: string, runtimeLogGroup: string) {
	const startTime = Date.now() - 60 * 60 * 1000;
	const filterPattern = `"${sessionId}"`;
	const [spansResp, logsResp] = await Promise.all([
		cloudWatch.send(
			new FilterLogEventsCommand({
				logGroupName: SPANS_LOG_GROUP,
				startTime,
				filterPattern,
				limit: 200,
			}),
		),
		cloudWatch.send(
			new FilterLogEventsCommand({
				logGroupName: runtimeLogGroup,
				startTime,
				filterPattern,
				limit: 200,
			}),
		),
	]);
	const spans = (spansResp.events || []).map((event) => JSON.parse(event.message!));
	const logs = (logsResp.events || [])
		.map((event) => {
			try {
				return JSON.parse(event.message!);
			} catch {
				return null;
			}
		})
		.filter(
			(record): record is { scope?: { name?: string }; spanId?: string } =>
				record !== null &&
				record.scope?.name === "strands.telemetry.tracer" &&
				Boolean(record.spanId),
		);
	return [...spans, ...logs];
}

async function waitForSpans(sessionId: string, runtimeLogGroup: string) {
	const start = performance.now();
	await new Promise((resolve) => setTimeout(resolve, SPAN_WAIT_INITIAL_MS));
	while (performance.now() - start < SPAN_WAIT_MAX_MS) {
		const data = await fetchSpansForSession(sessionId, runtimeLogGroup);
		const hasInvokeAgent = data.some(
			(span) =>
				typeof (span as { name?: string }).name === "string" &&
				(span as { name?: string }).name!.includes("invoke_agent"),
		);
		if (hasInvokeAgent) return data;
		await new Promise((resolve) => setTimeout(resolve, SPAN_WAIT_INTERVAL_MS));
	}
	return await fetchSpansForSession(sessionId, runtimeLogGroup);
}

async function callEvaluator(
	evaluatorId: string,
	sessionSpans: unknown[],
	timeoutMs: number,
) {
	const abortController = new AbortController();
	const timeout = setTimeout(() => abortController.abort(), timeoutMs);
	try {
		return await agentCore.send(
			new EvaluateCommand({
				evaluatorId,
				evaluationInput: { sessionSpans } as unknown as never,
			}),
			{ abortSignal: abortController.signal },
		);
	} finally {
		clearTimeout(timeout);
	}
}

async function measureDbWrite(run: EvalRun, testCase: EvalTestCase, sessionId: string) {
	const db = getDb();
	const start = performance.now();
	try {
		await db.transaction(async (tx) => {
			await tx.insert(evalResults).values({
				run_id: run.id,
				test_case_id: testCase.id,
				status: "error",
				score: null,
				duration_ms: 0,
				agent_session_id: sessionId,
				input: testCase.query,
				expected: null,
				actual_output: "",
				evaluator_results: [],
				assertions: [],
				error_message: "eval-stall-probe rollback measurement",
			} as typeof evalResults.$inferInsert);
			tx.rollback();
		});
	} catch (error) {
		if (!(error instanceof Error) || !error.message.includes("Rollback")) {
			throw error;
		}
	}
	return performance.now() - start;
}

async function probeOne(params: {
	args: CliArgs;
	run: EvalRun | null;
	testCase: EvalTestCase;
	index: number;
	tenantId: string;
	runtimeArn: string;
	runtimeLogGroup: string;
}): Promise<StageTiming> {
	const totalStart = performance.now();
	const sessionId = uniqueSessionId(params.run?.id ?? null, params.testCase.id, params.index);
	let invokeMs: number | null = null;
	let spanWaitMs: number | null = null;
	let evaluatorMs: number | null = null;
	let dbWriteMs: number | null = null;
	let evaluatorCount = 0;
	let spanCount = 0;
	let outputBytes = 0;
	let error: string | null = null;

	try {
		console.error(
			`[eval-stall-probe] ${params.index + 1}: invoking ${params.testCase.id} (${params.testCase.category})`,
		);
		const templateConfig = await loadTemplateConfig(params.testCase, params.run);
		const invoke = await timed(() =>
			invokeAgent({
				runtimeArn: params.runtimeArn,
				sessionId,
				tenantId: params.tenantId,
				assistantId: params.run?.agent_id ?? "eval-test-agent",
				prompt: params.testCase.query,
				systemPrompt: params.testCase.system_prompt,
				templateConfig,
				timeoutMs: params.args.invokeTimeoutMs,
			}),
		);
		invokeMs = invoke.ms;
		outputBytes = Buffer.byteLength(invoke.value, "utf8");
		console.error(
			`[eval-stall-probe] ${params.index + 1}: invoke finished in ${fmt(invokeMs)}`,
		);

		const evaluatorIds = (params.testCase.agentcore_evaluator_ids ?? []) as string[];
		if (evaluatorIds.length > 0) {
			console.error(`[eval-stall-probe] ${params.index + 1}: waiting for spans`);
			const spans = await timed(() => waitForSpans(sessionId, params.runtimeLogGroup));
			spanWaitMs = spans.ms;
			spanCount = spans.value.length;
			console.error(
				`[eval-stall-probe] ${params.index + 1}: span wait finished in ${fmt(spanWaitMs)} (${spanCount} spans)`,
			);
			const evaluatorStart = performance.now();
			for (const evaluatorId of evaluatorIds) {
				await callEvaluator(evaluatorId, spans.value, params.args.evaluatorTimeoutMs);
				evaluatorCount += 1;
			}
			evaluatorMs = performance.now() - evaluatorStart;
			console.error(
				`[eval-stall-probe] ${params.index + 1}: evaluators finished in ${fmt(evaluatorMs)}`,
			);
		}

		if (params.args.measureDbWrite && params.run) {
			dbWriteMs = await measureDbWrite(params.run, params.testCase, sessionId);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		console.error(`[eval-stall-probe] ${params.index + 1}: ${error}`);
	}

	return {
		runId: params.run?.id ?? null,
		testCaseId: params.testCase.id,
		testCaseName: params.testCase.name,
		category: params.testCase.category,
		sessionId,
		invokeMs,
		spanWaitMs,
		evaluatorMs,
		dbWriteMs,
		totalMs: performance.now() - totalStart,
		evaluatorCount,
		spanCount,
		outputBytes,
		error,
	};
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
) {
	const results: R[] = [];
	let nextIndex = 0;
	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await fn(items[index], index);
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
	);
	return results;
}

function percentile(values: number[], p: number) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[index];
}

function fmt(ms: number | null) {
	if (ms === null) return "n/a";
	if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
	return `${ms.toFixed(0)}ms`;
}

function stageStats(rows: StageTiming[], key: keyof StageTiming) {
	const values = rows
		.map((row) => row[key])
		.filter((value): value is number => typeof value === "number");
	return {
		count: values.length,
		p50: percentile(values, 50),
		p95: percentile(values, 95),
		max: values.length ? Math.max(...values) : null,
		sum: values.reduce((sum, value) => sum + value, 0),
	};
}

function renderMarkdown(args: CliArgs, rows: StageTiming[]) {
	const stages: Array<[string, keyof StageTiming]> = [
		["AgentCore invoke", "invokeMs"],
		["Span wait/fetch", "spanWaitMs"],
		["AgentCore evaluate", "evaluatorMs"],
		["DB insert rollback", "dbWriteMs"],
		["Total per case", "totalMs"],
	];
	const errors = rows.filter((row) => row.error);
	const dominant = stages
		.filter(([name]) => name !== "Total per case")
		.map(([name, key]) => ({ name, ...stageStats(rows, key) }))
		.filter((stage) => stage.count > 0)
		.sort((a, b) => b.sum - a.sum)[0];

	const lines = [
		"# Eval Runner Stall Probe",
		"",
		`- Run ID: ${args.runId ?? "n/a"}`,
		`- Tenant ID: ${args.tenantId ?? "from run"}`,
		`- Cases probed: ${rows.length}`,
		`- Concurrency: ${args.concurrency}`,
		`- DB write measured: ${args.measureDbWrite ? "yes, rollback-only" : "no"}`,
		`- Errors: ${errors.length}`,
		"",
		"## Stage Summary",
		"",
		"| Stage | Count | p50 | p95 | Max | Total |",
		"| --- | ---: | ---: | ---: | ---: | ---: |",
		...stages.map(([name, key]) => {
			const stat = stageStats(rows, key);
			return `| ${name} | ${stat.count} | ${fmt(stat.p50)} | ${fmt(stat.p95)} | ${fmt(stat.max)} | ${fmt(stat.sum)} |`;
		}),
		"",
		"## Interpretation",
		"",
		dominant
			? `Dominant measured stage by total elapsed time: **${dominant.name}** (${fmt(dominant.sum)} across measured cases).`
			: "No successful stage timings were collected.",
		"",
		"## Per-Case Timings",
		"",
		"| Case | Category | Invoke | Span wait | Evaluate | DB write | Total | Spans | Evaluators | Error |",
		"| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
		...rows.map(
			(row) =>
				`| ${row.testCaseName.replaceAll("|", "\\|")} | ${row.category} | ${fmt(row.invokeMs)} | ${fmt(row.spanWaitMs)} | ${fmt(row.evaluatorMs)} | ${fmt(row.dbWriteMs)} | ${fmt(row.totalMs)} | ${row.spanCount} | ${row.evaluatorCount} | ${row.error?.replaceAll("|", "\\|") ?? ""} |`,
		),
		"",
	];
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const db = getDb();
	const [run] = args.runId
		? await db.select().from(evalRuns).where(eq(evalRuns.id, args.runId))
		: [null];
	if (args.runId && !run) throw new Error(`Run not found: ${args.runId}`);
	const tenantId = run?.tenant_id ?? args.tenantId;
	if (!tenantId) throw new Error("Missing tenant id");
	const runtimeType = await resolveRuntimeType(run, tenantId);
	const runtimeId = await loadRuntimeId(runtimeType);
	const runtimeArn = `arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${runtimeId}`;
	const runtimeLogGroup = `${RUNTIME_LOG_GROUP_PREFIX}${runtimeId}-DEFAULT`;
	const cases = await loadCases(args, run);
	if (cases.length === 0) throw new Error("No enabled eval test cases matched");

	const rows = await mapWithConcurrency(cases, args.concurrency, (testCase, index) =>
		probeOne({
			args,
			run,
			testCase,
			index,
			tenantId,
			runtimeArn,
			runtimeLogGroup,
		}),
	);

	if (args.json) {
		console.log(JSON.stringify({ args, rows }, null, 2));
	} else {
		console.log(renderMarkdown(args, rows));
	}
	process.exit(0);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
