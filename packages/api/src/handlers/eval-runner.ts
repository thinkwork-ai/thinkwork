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
import {
  evalRuns,
  evalResults,
  evalTestCases,
  costEvents,
  agents,
  agentTemplates,
} from "@thinkwork/database-pg/schema";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  EvaluateCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { createHash } from "crypto";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";
import {
  normalizeAgentRuntimeType,
  type AgentRuntimeType,
} from "../lib/resolve-runtime-function-name.js";
import {
  recordEvaluationWorkflowEvidence,
  recordEvaluationWorkflowStep,
  updateEvaluationWorkflowRunSummary,
  type EvalSystemWorkflowContext,
} from "../lib/system-workflows/evaluation-runs.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "487219502366";
const SSM_RUNTIME_ID_STRANDS =
  process.env.AGENTCORE_RUNTIME_SSM_STRANDS ||
  "/thinkwork/dev/agentcore/runtime-id-strands";
const SSM_RUNTIME_ID_PI = process.env.AGENTCORE_RUNTIME_SSM_PI || "";
const SPANS_LOG_GROUP = process.env.SPANS_LOG_GROUP || "aws/spans";
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
const cw = new CloudWatchLogsClient({ region: REGION });

const cachedRuntimeIds: Partial<Record<AgentRuntimeType, string>> = {};

async function loadRuntimeId(runtimeType: AgentRuntimeType): Promise<string> {
  if (cachedRuntimeIds[runtimeType]) return cachedRuntimeIds[runtimeType];
  const parameterName =
    runtimeType === "pi" ? SSM_RUNTIME_ID_PI : SSM_RUNTIME_ID_STRANDS;
  if (!parameterName)
    throw new Error(
      `${runtimeType} AgentCore runtime SSM parameter is not configured`,
    );
  const resp = await ssm.send(new GetParameterCommand({ Name: parameterName }));
  if (!resp.Parameter?.Value)
    throw new Error(`SSM parameter ${parameterName} is empty`);
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalRunnerEvent {
  runId: string;
  systemWorkflowRunId?: string;
  systemWorkflowExecutionArn?: string;
  tenantId?: string;
}

interface Assertion {
  type: string; // "contains" | "regex" | "equals" | "json-path"
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueSessionId(
  runId: string,
  testCaseId: string | null,
  idx: number,
): string {
  return createHash("sha256")
    .update(`evalrun:${runId}:${testCaseId ?? "ad-hoc"}:${idx}:${Date.now()}`)
    .digest("hex")
    .slice(0, 64);
}

const JUDGE_MODEL_ID =
  process.env.EVAL_JUDGE_MODEL_ID ??
  "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * LLM-as-judge for `llm-rubric` assertions. Asks the judge model to score
 * whether the agent's response meets the given rubric, on a 0–1 scale with
 * a short reasoning. Falls back to a keyword heuristic if Bedrock rejects.
 */
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
      "[eval-runner] LLM judge failed, falling back to heuristic:",
      err,
    );
    return llmRubricHeuristic(output, rubric);
  }
}

/**
 * Keyword-based fallback when the judge model is unavailable. Treats rubrics
 * that mention "refuse" / "should not" as pass-if-response-contains-refusal.
 */
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
          reason: matched ? `Matches /${value}/` : `Does not match /${value}/`,
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
    if (!systemPrompt && templateConfig.system_prompt)
      payload.system_prompt = templateConfig.system_prompt;
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

async function fetchSpansForSession(
  sessionId: string,
  runtimeLogGroup: string,
): Promise<unknown[]> {
  const startTime = Date.now() - 60 * 60 * 1000;
  const filterPattern = `"${sessionId}"`;
  const [spansResp, logsResp] = await Promise.all([
    cw.send(
      new FilterLogEventsCommand({
        logGroupName: SPANS_LOG_GROUP,
        startTime,
        filterPattern,
        limit: 200,
      }),
    ),
    cw.send(
      new FilterLogEventsCommand({
        logGroupName: runtimeLogGroup,
        startTime,
        filterPattern,
        limit: 200,
      }),
    ),
  ]);
  const spans = (spansResp.events || []).map((e) => JSON.parse(e.message!));
  const logs = (logsResp.events || [])
    .map((e) => {
      try {
        return JSON.parse(e.message!);
      } catch {
        return null;
      }
    })
    .filter(
      (r): r is { scope?: { name?: string }; spanId?: string } =>
        r !== null &&
        r.scope?.name === "strands.telemetry.tracer" &&
        Boolean(r.spanId),
    );
  return [...spans, ...logs];
}

async function waitForSpans(
  sessionId: string,
  runtimeLogGroup: string,
  expectedSpanName = "invoke_agent",
): Promise<unknown[]> {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, SPAN_WAIT_INITIAL_MS));
  while (Date.now() - start < SPAN_WAIT_MAX_MS) {
    const data = await fetchSpansForSession(sessionId, runtimeLogGroup);
    const hasInvokeAgent = data.some(
      (d) =>
        typeof (d as { name?: string }).name === "string" &&
        (d as { name?: string }).name!.includes(expectedSpanName),
    );
    if (hasInvokeAgent) return data;
    await new Promise((r) => setTimeout(r, SPAN_WAIT_INTERVAL_MS));
  }
  // Return whatever we have even if invoke_agent span not found.
  return await fetchSpansForSession(sessionId, runtimeLogGroup);
}

async function callEvaluator(
  evaluatorId: string,
  sessionSpans: unknown[],
): Promise<EvaluatorResult> {
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
    if (!r)
      return {
        evaluator_id: evaluatorId,
        source: "agentcore",
        value: null,
        label: null,
        explanation: null,
        error: "no result returned",
      };
    if (r.errorMessage)
      return {
        evaluator_id: evaluatorId,
        source: "agentcore",
        value: null,
        label: null,
        explanation: null,
        error: r.errorMessage,
      };
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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: EvalRunnerEvent): Promise<{
  ok: boolean;
  runId: string;
  error?: string;
  passRate?: number;
  passedThreshold?: boolean;
}> {
  const { runId } = event;
  if (!runId) return { ok: false, runId: "", error: "missing runId" };

  const db = getDb();
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId));
  if (!run) return { ok: false, runId, error: "run not found" };

  console.log(
    `[eval-runner] starting runId=${runId} tenant=${run.tenant_id} agent=${run.agent_id}`,
  );

  const workflowContext: EvalSystemWorkflowContext | null =
    event.systemWorkflowRunId
      ? {
          tenantId: event.tenantId ?? run.tenant_id,
          runId: event.systemWorkflowRunId,
          executionArn: event.systemWorkflowExecutionArn ?? null,
        }
      : null;

  try {
    // Load test cases for this tenant. Filter by category if the run scoped them.
    const cases = await db
      .select()
      .from(evalTestCases)
      .where(
        and(
          eq(evalTestCases.tenant_id, run.tenant_id),
          eq(evalTestCases.enabled, true),
          run.categories.length > 0
            ? inArray(evalTestCases.category, run.categories)
            : sql`true`,
        ),
      );

    await recordEvaluationWorkflowStep(workflowContext, {
      nodeId: "SnapshotTestPack",
      stepType: "checkpoint",
      status: "succeeded",
      finishedAt: new Date(),
      outputJson: {
        evalRunId: runId,
        totalTests: cases.length,
        categories: run.categories,
      },
      idempotencyKey: `eval:${runId}:snapshot`,
    });

    const runtimeType = await resolveEvalRuntimeType(run);
    const runtimeId = await loadRuntimeId(runtimeType);
    const runtimeArn = `arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT_ID}:runtime/${runtimeId}`;
    const runtimeLogGroup = `${RUNTIME_LOG_GROUP_PREFIX}${runtimeId}-DEFAULT`;

    // Mark running.
    const startedAt = new Date();
    await db
      .update(evalRuns)
      .set({
        status: "running",
        started_at: startedAt,
        total_tests: cases.length,
      })
      .where(eq(evalRuns.id, runId));
    await notifyEvalRunUpdate({
      runId,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "running",
      totalTests: cases.length,
    });

    await recordEvaluationWorkflowStep(workflowContext, {
      nodeId: "RunEvaluation",
      stepType: "worker",
      status: "running",
      startedAt,
      outputJson: { totalTests: cases.length },
      idempotencyKey: `eval:${runId}:runner-started`,
    });

    // Run tests with bounded concurrency so the Lambda doesn't hit its 900s
    // timeout on larger packs. Each test is independent: own session ID, own
    // DB insert; the only shared state is the aggregate counters below, which
    // we accumulate once every batch resolves.
    const CONCURRENCY = 5;

    async function runOneTest(
      tc: (typeof cases)[number],
      i: number,
    ): Promise<{ passed: boolean; costUsd: number }> {
      const sessionId = uniqueSessionId(runId, tc.id, i);
      console.log(
        `[eval-runner] test ${i + 1}/${cases.length} '${tc.name}' session=${sessionId.slice(0, 12)}`,
      );

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
        const templateId =
          tc.agent_template_id ?? run.agent_template_id ?? null;
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

        // Assertions — deterministic types evaluated locally, llm-rubric judged
        // by Bedrock (claude-haiku-4-5) with a keyword-heuristic fallback.
        const assertions = (tc.assertions ?? []) as Assertion[];
        for (const a of assertions) {
          const r = await evaluateAssertion(a, actualOutput, tc.query);
          assertionResults.push({
            ...a,
            passed: r.passed,
            reason: r.reason,
            score: r.score,
          });
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

      // Score = average across assertion + evaluator scores (maniflow pattern).
      // Each assertion contributes score ?? (passed ? 1 : 0); each evaluator
      // contributes its numeric value if present. Pass/fail = all pass.
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
          ? contributingScores.reduce((s, v) => s + v, 0) /
            contributingScores.length
          : assertionsPassed
            ? 1
            : 0;
      const status = errorMessage
        ? "error"
        : assertionsPassed && evaluatorsPassed
          ? "pass"
          : "fail";

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
      const results = await Promise.all(
        batch.map((tc, j) => runOneTest(tc, offset + j)),
      );
      for (const r of results) {
        if (r.passed) passed++;
        else failed++;
        totalCostUsd += r.costUsd;
      }
    }

    await recordEvaluationWorkflowStep(workflowContext, {
      nodeId: "RunEvaluation",
      stepType: "worker",
      status: "succeeded",
      finishedAt: new Date(),
      outputJson: { passed, failed, totalTests: cases.length },
      idempotencyKey: `eval:${runId}:runner-finished`,
    });

    // Aggregate.
    const completedAt = new Date();
    const passRate = cases.length > 0 ? passed / cases.length : 0;
    await db
      .update(evalRuns)
      .set({
        status: "completed",
        completed_at: completedAt,
        passed,
        failed,
        pass_rate: passRate.toFixed(4),
        cost_usd: totalCostUsd.toFixed(6),
      })
      .where(eq(evalRuns.id, runId));

    if (totalCostUsd > 0 && run.agent_id) {
      await db
        .insert(costEvents)
        .values({
          tenant_id: run.tenant_id,
          agent_id: run.agent_id,
          request_id: `eval-run-${runId}`,
          event_type: "eval_compute",
          amount_usd: totalCostUsd.toFixed(6),
          metadata: {
            source: "eval-runner",
            run_id: runId,
            total_tests: cases.length,
          },
        })
        .onConflictDoNothing();
    }

    const totalCostUsdCents = Math.round(totalCostUsd * 100);
    const evidenceSummary = {
      evalRunId: runId,
      totalTests: cases.length,
      passed,
      failed,
      passRate,
      totalCostUsdCents,
    };
    const passedThreshold = passRate >= PASS_THRESHOLD;
    await recordEvaluationWorkflowStep(workflowContext, {
      nodeId: "AggregateScores",
      stepType: "aggregation",
      status: "succeeded",
      finishedAt: completedAt,
      outputJson: evidenceSummary,
      idempotencyKey: `eval:${runId}:aggregate`,
    });
    await recordEvaluationWorkflowStep(workflowContext, {
      nodeId: "ApplyPassFailGate",
      stepType: "gate",
      status: passedThreshold ? "succeeded" : "failed",
      finishedAt: completedAt,
      outputJson: {
        passRate,
        threshold: PASS_THRESHOLD,
      },
      idempotencyKey: `eval:${runId}:pass-fail-gate`,
    });
    await recordEvaluationWorkflowEvidence(workflowContext, {
      evidenceType: "score-summary",
      title: "Evaluation score summary",
      summary: `${passed}/${cases.length} tests passed (${(passRate * 100).toFixed(1)}%).`,
      artifactJson: evidenceSummary,
      complianceTags: ["evaluation", "quality"],
      idempotencyKey: `eval:${runId}:score-summary`,
    });
    await updateEvaluationWorkflowRunSummary(workflowContext, evidenceSummary);

    await notifyEvalRunUpdate({
      runId,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "completed",
      totalTests: cases.length,
      passed,
      failed,
      passRate,
    });

    console.log(
      `[eval-runner] runId=${runId} done: ${passed}/${cases.length} passed (${(passRate * 100).toFixed(1)}%) cost=$${totalCostUsd.toFixed(4)}`,
    );
    return { ok: true, runId, passRate, passedThreshold };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const completedAt = new Date();
    await db
      .update(evalRuns)
      .set({
        status: "failed",
        completed_at: completedAt,
        error_message: message,
      })
      .where(eq(evalRuns.id, runId));
    await recordEvaluationWorkflowStep(workflowContext, {
      nodeId: "RunEvaluation",
      stepType: "worker",
      status: "failed",
      finishedAt: completedAt,
      errorJson: { message },
      idempotencyKey: `eval:${runId}:runner-failed`,
    });
    await recordEvaluationWorkflowEvidence(workflowContext, {
      evidenceType: "score-summary",
      title: "Evaluation failed",
      summary: message,
      artifactJson: { evalRunId: runId, error: message },
      complianceTags: ["evaluation", "quality"],
      idempotencyKey: `eval:${runId}:score-summary`,
    });
    await updateEvaluationWorkflowRunSummary(workflowContext, {
      evalRunId: runId,
      error: message,
    });
    await notifyEvalRunUpdate({
      runId,
      tenantId: run.tenant_id,
      agentId: run.agent_id,
      status: "failed",
      errorMessage: message,
    });
    console.error(`[eval-runner] runId=${runId} failed:`, message);
    return { ok: false, runId, error: message, passedThreshold: false };
  }
}
