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

const threadId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const traceId = `smoke-trace-${threadId}`;

const payload: Record<string, unknown> = {
	message: MESSAGE,
	messages_history: [],
	assistant_id: AGENT_ID,
	thread_id: threadId,
	tenant_id: TENANT_ID,
	user_id: USER_ID,
	trace_id: traceId,
	tenant_slug: TENANT_SLUG,
	instance_id: INSTANCE_ID,
	sandbox_interpreter_id: SANDBOX_INTERPRETER_ID,
	workspace_tenant_id: TENANT_ID,
};

function fail(reason: string, context?: Record<string, unknown>): never {
	console.error(`[flue-smoke] FAIL: ${reason}`);
	if (context) console.error(`[flue-smoke] context:`, JSON.stringify(context, null, 2));
	process.exit(1);
}

async function main(): Promise<void> {
	console.log(
		`[flue-smoke] stage=${STAGE} function=${FUNCTION_NAME} agent=${AGENT_ID} thread=${threadId}`,
	);

	const client = new LambdaClient({ region: REGION });
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
		fail(`Lambda returned FunctionError=${result.FunctionError}`, {
			payload: errorPayload,
			duration_ms: durationMs,
		});
	}

	if (!result.Payload) {
		fail("Lambda returned no payload (LWA routing or Lambda crash)", {
			status_code: result.StatusCode,
			duration_ms: durationMs,
		});
	}

	const responseStr = new TextDecoder().decode(result.Payload);
	let response: FlueResponseShape;
	try {
		response = JSON.parse(responseStr);
	} catch (err) {
		fail("Lambda response is not JSON (LWA routing break?)", {
			raw_response: responseStr.slice(0, 500),
			parse_error: err instanceof Error ? err.message : String(err),
			duration_ms: durationMs,
		});
	}

	if (response.error) {
		fail(`Lambda returned error="${response.error}"`, {
			full_response: response,
			duration_ms: durationMs,
		});
	}

	if (response.runtime !== "flue") {
		fail(`response.runtime is "${response.runtime}", expected "flue"`, {
			full_response: response,
		});
	}

	const totalTokens = response.response?.usage?.totalTokens ?? 0;
	if (totalTokens === 0) {
		fail(
			"response.usage.totalTokens is 0 — Bedrock not invoked (silent ValidationException? IAM AccessDenied? pi-agent-core swallow?)",
			{ full_response: response, duration_ms: durationMs },
		);
	}

	const content = String(response.response?.content ?? "").trim();
	if (!content) {
		fail("response.content is empty even though tokens were consumed", {
			full_response: response,
			duration_ms: durationMs,
		});
	}

	const fingerprintRegex = new RegExp(EXPECTED_FINGERPRINT, "i");
	if (!fingerprintRegex.test(content)) {
		fail(
			`response.content does not contain fingerprint "${EXPECTED_FINGERPRINT}" — workspace prompt loader not pulling USER.md?`,
			{ content, duration_ms: durationMs },
		);
	}

	const cost = response.response?.usage?.cost?.total;
	console.log(
		`[flue-smoke] PASS: model=${response.response?.model} tokens=${totalTokens} cost=$${cost ?? "?"} duration_ms=${durationMs}`,
	);
	console.log(
		`[flue-smoke] content (first 200 chars): ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`,
	);
}

main().catch((err) => {
	console.error("[flue-smoke] uncaught error:", err);
	process.exit(1);
});
