/**
 * Post-deploy smoke for the Flue runtime end-to-end path.
 *
 * Why this exists: on 2026-05-05 a chain of bugs (LWA routing, Bedrock
 * IAM, Sonnet 4.5 inference-profile prefix, missing workspace-prompt
 * loader) shipped to dev silently — each was caught only when an
 * operator clicked through the admin UI and saw a wrong answer. None
 * of those bugs would survive a smoke that exercises the real Flue
 * Lambda and asserts the response includes a USER.md fingerprint.
 *
 * Scope: invokes the Flue dispatcher Lambda directly with a populated
 * payload that mirrors what `chat-agent-invoke` would compose for
 * Marco. Asserts:
 *   1. Lambda returns a JSON response (catches LWA routing breaks).
 *   2. `response.runtime === "flue"`.
 *   3. `response.usage.totalTokens > 0` (catches silent ValidationException
 *      / AccessDenied where pi-agent-core swallows the error).
 *   4. `response.content` contains the USER.md fingerprint (default:
 *      "Eric"). This is the workspace-prompt-loaded check that the
 *      morning of 2026-05-05 shipped without.
 *
 * Defaults are dev-tenant + Marco's IDs. Override via env vars to run
 * against another stage/agent. Sandbox interpreter ID is per-tenant
 * and rotates rarely — hardcoded for dev with env override available.
 */

import {
	InvokeCommand,
	LambdaClient,
} from "@aws-sdk/client-lambda";

interface FlueResponseShape {
	runtime?: string;
	response?: {
		content?: string;
		role?: string;
		model?: string;
		usage?: {
			totalTokens?: number;
			input?: number;
			output?: number;
			cost?: { total?: number };
		};
		tool_invocations?: unknown[];
	};
	flue_usage?: unknown;
	flue_retain?: {
		retained?: boolean;
		error?: string;
	};
	error?: string;
}

const STAGE = process.env.STAGE || "dev";
const REGION =
	process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

const FUNCTION_NAME =
	process.env.SMOKE_FUNCTION_NAME || `thinkwork-${STAGE}-agentcore-flue`;

// Marco (dev) defaults. Override via env vars per stage / agent.
const AGENT_ID =
	process.env.SMOKE_AGENT_ID || "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c";
const TENANT_ID =
	process.env.SMOKE_TENANT_ID || "0015953e-aa13-4cab-8398-2e70f73dda63";
const USER_ID =
	process.env.SMOKE_USER_ID || "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG || "sleek-squirrel-230";
const INSTANCE_ID = process.env.SMOKE_INSTANCE_ID || "fleet-caterpillar-456";
const SANDBOX_INTERPRETER_ID =
	process.env.SMOKE_SANDBOX_INTERPRETER_ID ||
	"thinkwork_dev_0015953e_pub-5rETNEk2Vt";
const MESSAGE = process.env.SMOKE_MESSAGE || "What is my name?";
// Default fingerprint — Eric Odom is Marco's USER.md author. The smoke
// is intentionally case-insensitive so the agent can phrase the answer
// any way ("Eric", "Your name is Eric", "you're Eric Odom").
const EXPECTED_FINGERPRINT = process.env.SMOKE_FINGERPRINT || "Eric";

function freshThreadId(): string {
	return `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface ScenarioResult {
	scenario: string;
	tokens: number;
	model: string | undefined;
	contentPreview: string;
	durationMs: number;
	retain?: { retained: boolean; error?: string };
}

interface ScenarioOptions {
	/**
	 * When true, assert `flue_retain.retained === true` in the response.
	 * Pins that the runtime dispatched the per-turn auto-retain Lambda
	 * invoke. Used by the memory-bearing scenario.
	 */
	expectRetain?: boolean;
}

function fail(reason: string, context?: Record<string, unknown>): never {
	console.error(`[flue-smoke] FAIL: ${reason}`);
	if (context) console.error(`[flue-smoke] context:`, JSON.stringify(context, null, 2));
	process.exit(1);
}

async function invokeFlue(
	client: LambdaClient,
	scenario: string,
	payload: Record<string, unknown>,
	expectedFingerprint: RegExp,
	options: ScenarioOptions = {},
): Promise<ScenarioResult> {
	const cmd = new InvokeCommand({
		FunctionName: FUNCTION_NAME,
		InvocationType: "RequestResponse",
		Payload: Buffer.from(JSON.stringify(payload)),
	});

	const start = Date.now();
	const result = await client.send(cmd);
	const durationMs = Date.now() - start;

	if (result.FunctionError) {
		const errorPayload = result.Payload
			? new TextDecoder().decode(result.Payload)
			: "<no payload>";
		fail(`[${scenario}] Lambda returned FunctionError=${result.FunctionError}`, {
			payload: errorPayload,
			duration_ms: durationMs,
		});
	}

	if (!result.Payload) {
		fail(`[${scenario}] Lambda returned no payload (LWA routing or Lambda crash)`, {
			status_code: result.StatusCode,
			duration_ms: durationMs,
		});
	}

	const responseStr = new TextDecoder().decode(result.Payload);
	let response: FlueResponseShape;
	try {
		response = JSON.parse(responseStr);
	} catch (err) {
		fail(`[${scenario}] Lambda response is not JSON (LWA routing break?)`, {
			raw_response: responseStr.slice(0, 500),
			parse_error: err instanceof Error ? err.message : String(err),
			duration_ms: durationMs,
		});
	}

	if (response.error) {
		fail(`[${scenario}] Lambda returned error="${response.error}"`, {
			full_response: response,
			duration_ms: durationMs,
		});
	}

	if (response.runtime !== "flue") {
		fail(`[${scenario}] response.runtime is "${response.runtime}", expected "flue"`, {
			full_response: response,
		});
	}

	const totalTokens = response.response?.usage?.totalTokens ?? 0;
	if (totalTokens === 0) {
		fail(
			`[${scenario}] response.usage.totalTokens is 0 — Bedrock not invoked (silent ValidationException? IAM AccessDenied? pi-agent-core swallow on malformed history?)`,
			{ full_response: response, duration_ms: durationMs },
		);
	}

	const content = String(response.response?.content ?? "").trim();
	if (!content) {
		fail(
			`[${scenario}] response.content is empty even though tokens were consumed`,
			{ full_response: response, duration_ms: durationMs },
		);
	}

	if (!expectedFingerprint.test(content)) {
		fail(
			`[${scenario}] response.content does not match expected fingerprint`,
			{ content, expected: expectedFingerprint.source, duration_ms: durationMs },
		);
	}

	const retain = response.flue_retain;
	if (options.expectRetain) {
		if (!retain) {
			fail(
				`[${scenario}] response.flue_retain is missing — the runtime did not surface retain status (older container? response shape regression?)`,
				{ full_response: response, duration_ms: durationMs },
			);
		}
		if (retain.retained !== true) {
			fail(
				`[${scenario}] response.flue_retain.retained=${retain.retained} despite use_memory=true — auto-retain dispatch did not fire`,
				{
					retain,
					duration_ms: durationMs,
					hint: "Check MEMORY_RETAIN_FN_NAME env var, IAM MemoryRetainInvoke policy, and Flue Lambda CloudWatch logs for memory_retain_failed events.",
				},
			);
		}
	}

	return {
		scenario,
		tokens: totalTokens,
		model: response.response?.model,
		contentPreview: `${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`,
		durationMs,
		retain: retain
			? {
					retained: Boolean(retain.retained),
					...(retain.error ? { error: retain.error } : {}),
				}
			: undefined,
	};
}

async function main(): Promise<void> {
	console.log(
		`[flue-smoke] stage=${STAGE} function=${FUNCTION_NAME} agent=${AGENT_ID}`,
	);

	const client = new LambdaClient({ region: REGION });

	// Scenario 1: fresh thread (zero history) — exercises the workspace
	// prompt loader, model resolver, IAM, LWA routing.
	const fresh = await invokeFlue(
		client,
		"fresh-thread",
		{
			message: MESSAGE,
			messages_history: [],
			assistant_id: AGENT_ID,
			thread_id: freshThreadId(),
			tenant_id: TENANT_ID,
			user_id: USER_ID,
			trace_id: `smoke-trace-${Date.now()}`,
			tenant_slug: TENANT_SLUG,
			instance_id: INSTANCE_ID,
			sandbox_interpreter_id: SANDBOX_INTERPRETER_ID,
			workspace_tenant_id: TENANT_ID,
		},
		new RegExp(EXPECTED_FINGERPRINT, "i"),
	);

	// Scenario 2: multi-turn (non-empty history) — exercises
	// `normalizeHistory`'s assistant-message conversion. Pre-fix the
	// AssistantMessage entry was structurally invalid (string content
	// vs the required TextContent[] + missing api/provider/model/usage/
	// stopReason fields), pi-ai's Agent silently swallowed it, and the
	// turn returned content="" with totalTokens=0. The follow-up
	// question pins recall: the agent must reference the prior turn's
	// content. Fingerprint is intentionally generic ("CRM" or
	// "opportunities") since the model phrases recall variably.
	const multiTurn = await invokeFlue(
		client,
		"multi-turn-history",
		{
			message: "What did I just ask you?",
			messages_history: [
				{
					role: "user",
					content: "What are the last 5 opportunities in the CRM?",
				},
				{
					role: "assistant",
					content: "Here are the 5 most recent opportunities in the CRM.",
				},
			],
			assistant_id: AGENT_ID,
			thread_id: freshThreadId(),
			tenant_id: TENANT_ID,
			user_id: USER_ID,
			trace_id: `smoke-trace-${Date.now()}`,
			tenant_slug: TENANT_SLUG,
			instance_id: INSTANCE_ID,
			sandbox_interpreter_id: SANDBOX_INTERPRETER_ID,
			workspace_tenant_id: TENANT_ID,
		},
		// Recall test: any reasonable phrasing of the prior question
		// will mention CRM or opportunities. If the agent returns
		// "I don't have prior context" or similar, the regex will fail.
		/\b(CRM|opportunit(?:y|ies))\b/i,
	);

	// Scenario 3: memory-bearing — pins the end-of-turn auto-retain
	// dispatch path. Sends `use_memory: true` and asserts the response
	// surfaces `flue_retain.retained === true`. The retain Lambda invoke
	// itself is fire-and-forget (Event invocation type), so this scenario
	// catches Flue-side regressions: missing MEMORY_RETAIN_FN_NAME env,
	// IAM revocation on MemoryRetainInvoke, LambdaClient construction
	// throwing, server.ts hook removed, await semantics broken. Does NOT
	// verify Hindsight reflection latency or recall correctness — those
	// are operator-driven full-loop checks (admin chat: "remember X" then
	// fresh thread "what's X?"), not deploy gates.
	const memoryBearing = await invokeFlue(
		client,
		"memory-bearing",
		{
			message: "Please confirm you got my last message.",
			messages_history: [
				{
					role: "user",
					content:
						"This is a smoke-test fact: my favorite hot beverage is lapsang souchong tea. Please confirm.",
				},
				{
					role: "assistant",
					content:
						"Got it — your favorite hot beverage is lapsang souchong tea.",
				},
			],
			assistant_id: AGENT_ID,
			thread_id: freshThreadId(),
			tenant_id: TENANT_ID,
			user_id: USER_ID,
			trace_id: `smoke-trace-${Date.now()}`,
			tenant_slug: TENANT_SLUG,
			instance_id: INSTANCE_ID,
			sandbox_interpreter_id: SANDBOX_INTERPRETER_ID,
			workspace_tenant_id: TENANT_ID,
			use_memory: true,
		},
		// The agent's confirmation phrasing varies; any acknowledgement
		// signal is sufficient for the content check. The load-bearing
		// assertion is `flue_retain.retained === true` (handled by
		// `expectRetain` below).
		/\b(confirm|got|noted|yes|received|hear)\b/i,
		{ expectRetain: true },
	);

	for (const r of [fresh, multiTurn, memoryBearing]) {
		console.log(
			`[flue-smoke] PASS [${r.scenario}]: model=${r.model} tokens=${r.tokens} duration_ms=${r.durationMs}`,
		);
		console.log(`[flue-smoke]   content: ${r.contentPreview}`);
		if (r.retain) {
			console.log(
				`[flue-smoke]   flue_retain: retained=${r.retain.retained}${r.retain.error ? ` error=${r.retain.error}` : ""}`,
			);
		}
	}
}

main().catch((err) => {
	console.error("[flue-smoke] uncaught error:", err);
	process.exit(1);
});
