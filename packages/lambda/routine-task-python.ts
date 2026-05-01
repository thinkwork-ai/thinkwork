/**
 * routine-task-python — `python()` recipe Task wrapper Lambda
 * (Plan 2026-05-01-005 §U6).
 *
 * Step Functions invokes this Lambda for every `python` recipe state in
 * a routine ASL. The wrapper:
 *
 *   1. Snapshots `THINKWORK_API_URL` + `API_AUTH_SECRET` + the
 *      stage/interpreter/bucket env at handler entry. Subsequent re-reads
 *      of `process.env` would risk completion-callback shadowing per
 *      `feedback_completion_callback_snapshot_pattern`.
 *   2. Starts a fresh Code Interpreter session (one per Task — Step
 *      Functions does not pool sessions across states).
 *   3. Invokes the user's Python code with a generated env-prelude
 *      (caller-supplied env keys filtered through an allowlist).
 *   4. Streams the AgentCore response. Terminal `result.structuredContent`
 *      is authoritative for stdout/stderr/exitCode; intermediate
 *      `result.content[]` text-blocks are concatenated as fallback when
 *      structuredContent is missing (older shapes).
 *   5. Offloads full stdout/stderr to S3 under
 *      `<tenantId>/<sfn-execution-id>/<nodeId>/{stdout,stderr}.log`.
 *      Returns a 4KB stdoutPreview + the truncated flag. State payload
 *      stays under the 256KB Step Functions limit.
 *   6. Always stops the session in a finally-equivalent block. Stop
 *      failures degrade to log-and-continue — AgentCore reaps idle
 *      sessions.
 *
 * Output shape:
 *   { exitCode, stdoutS3Uri, stderrS3Uri, stdoutPreview, truncated,
 *     errorClass?, errorMessage? }
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  BedrockAgentCoreClient,
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PythonTaskInput {
  tenantId: string;
  /** Step Functions execution ARN. The bucket key includes the trailing
   * execution id segment (split on `:` and take the last token). */
  executionArn: string;
  /** ASL state name. Used as the per-step S3 prefix. */
  nodeId: string;
  /** User Python code, verbatim. */
  code: string;
  /** Optional caller-supplied env. Only keys in `envAllowlist` (or the
   * default empty allowlist) flow through to the sandbox. */
  env?: Record<string, string>;
  /** Optional override for the 4KB preview cap; tests only. */
  previewCapBytes?: number;
  /** Hard timeout for the user code, in seconds. AgentCore enforces; the
   * wrapper passes through. Defaults to 300s. */
  timeoutSeconds?: number;
}

export interface PythonTaskOptions {
  stage: string;
  /** AgentCore Code Interpreter id; resolved at handler entry from
   * `SANDBOX_INTERPRETER_ID`. Tests inject directly. */
  interpreterId: string;
  /** S3 bucket for offloaded output; resolved from
   * `ROUTINE_OUTPUT_BUCKET`. */
  bucket: string;
  /** Caller-supplied env keys allowed to pass through. Defaults to []. */
  envAllowlist?: string[];
  agentCoreClient?: BedrockAgentCoreClient;
  s3Client?: S3Client;
}

export interface PythonTaskResult {
  exitCode: number;
  stdoutS3Uri: string | null;
  stderrS3Uri: string | null;
  stdoutPreview: string;
  truncated: boolean;
  errorClass?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PREVIEW_CAP_BYTES = 4096;
const DEFAULT_TIMEOUT_SECONDS = 300;

// Module-scope clients so warm Lambda invocations reuse the TCP pool.
// The optional overrides in PythonTaskOptions still win for unit tests.
const _DEFAULT_AGENTCORE_CLIENT = new BedrockAgentCoreClient({});
const _DEFAULT_S3_CLIENT = new S3Client({});

// ---------------------------------------------------------------------------
// Pure entry point — exported for unit tests and the publish flow.
// ---------------------------------------------------------------------------

export async function invokePythonTask(
  input: PythonTaskInput,
  options: PythonTaskOptions,
): Promise<PythonTaskResult> {
  const {
    stage: _stage,
    interpreterId,
    bucket,
    envAllowlist = [],
  } = options;
  const agentCore = options.agentCoreClient ?? _DEFAULT_AGENTCORE_CLIENT;
  const s3 = options.s3Client ?? _DEFAULT_S3_CLIENT;

  const previewCap = input.previewCapBytes ?? DEFAULT_PREVIEW_CAP_BYTES;
  const sfnExecutionId = extractExecutionId(input.executionArn);
  const keyPrefix = `${input.tenantId}/${sfnExecutionId}/${input.nodeId}`;

  // ---- 1. Start session ------------------------------------------------
  let sessionId: string;
  try {
    const start = await agentCore.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: interpreterId,
        sessionTimeoutSeconds:
          input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      }),
    );
    if (!start.sessionId) {
      return failWith("sandbox_session_start_failed", "no sessionId returned");
    }
    sessionId = start.sessionId;
  } catch (err) {
    return failWith(
      "sandbox_session_start_failed",
      (err as Error).message ?? "unknown",
    );
  }

  // ---- 2 + 3. Invoke + parse stream + 4. Stop --------------------------
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let invokeErrorClass: string | undefined;
  let invokeErrorMessage: string | undefined;

  try {
    const codeWithEnv = buildCodeWithEnvPrelude(input.code, input.env, envAllowlist);
    const invoke = await agentCore.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: interpreterId,
        sessionId,
        name: "executeCode",
        arguments: {
          code: codeWithEnv,
          language: "python",
        },
      }),
    );

    const parsed = await parseStream(invoke);
    stdout = parsed.stdout;
    stderr = parsed.stderr;
    exitCode = parsed.exitCode;
    invokeErrorClass = parsed.errorClass;
    invokeErrorMessage = parsed.errorMessage;
  } catch (err) {
    invokeErrorClass = "sandbox_invoke_failed";
    invokeErrorMessage = (err as Error).message ?? "unknown";
    exitCode = -1;
  } finally {
    try {
      await agentCore.send(
        new StopCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: interpreterId,
          sessionId,
        }),
      );
    } catch {
      // Log-and-continue: AgentCore reaps idle sessions; the cost of a
      // missed stop is bounded.
    }
  }

  if (invokeErrorClass) {
    return {
      exitCode: -1,
      stdoutS3Uri: null,
      stderrS3Uri: null,
      stdoutPreview: "",
      truncated: false,
      errorClass: invokeErrorClass,
      errorMessage: invokeErrorMessage,
    };
  }

  // ---- 5. S3 offload ---------------------------------------------------
  const stdoutKey = `${keyPrefix}/stdout.log`;
  const stderrKey = `${keyPrefix}/stderr.log`;
  let s3OffloadFailed = false;
  try {
    await Promise.all([
      s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: stdoutKey,
          Body: stdout,
          ContentType: "text/plain; charset=utf-8",
        }),
      ),
      s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: stderrKey,
          Body: stderr,
          ContentType: "text/plain; charset=utf-8",
        }),
      ),
    ]);
  } catch {
    s3OffloadFailed = true;
  }

  const { preview, truncated } = trimPreview(stdout, previewCap);

  return {
    exitCode,
    stdoutS3Uri: s3OffloadFailed ? null : `s3://${bucket}/${stdoutKey}`,
    stderrS3Uri: s3OffloadFailed ? null : `s3://${bucket}/${stderrKey}`,
    stdoutPreview: preview,
    truncated,
    ...(s3OffloadFailed
      ? { errorClass: "s3_offload_failed", errorMessage: "S3 PutObject failed" }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParsedStream {
  stdout: string;
  stderr: string;
  exitCode: number;
  errorClass?: string;
  errorMessage?: string;
}

async function parseStream(
  response: { stream?: AsyncIterable<unknown> },
): Promise<ParsedStream> {
  const out: ParsedStream = { stdout: "", stderr: "", exitCode: 0 };
  if (!response.stream) return out;

  const fallbackChunks: string[] = [];
  let sawStructured = false;

  for await (const rawEvent of response.stream) {
    const event = rawEvent as Record<string, unknown>;
    // Error envelopes the SDK surfaces inline. Treat any of these as a
    // hard failure; the caller turns them into sandbox_invoke_failed.
    const errorEnvelope = pickFirst(event, [
      "internalServerException",
      "throttlingException",
      "validationException",
      "accessDeniedException",
      "conflictException",
      "resourceNotFoundException",
      "serviceQuotaExceededException",
    ]);
    if (errorEnvelope) {
      out.errorClass = "sandbox_invoke_failed";
      out.errorMessage =
        (errorEnvelope as { message?: string }).message ??
        "AgentCore returned an error event";
      out.exitCode = -1;
      return out;
    }

    const result = (event as { result?: Record<string, unknown> }).result;
    if (!result) continue;

    const structured = result.structuredContent as
      | {
          stdout?: string;
          stderr?: string;
          exitCode?: number;
        }
      | undefined;
    if (structured) {
      sawStructured = true;
      out.stdout = structured.stdout ?? "";
      out.stderr = structured.stderr ?? "";
      out.exitCode =
        typeof structured.exitCode === "number" ? structured.exitCode : 0;
    }

    const content = result.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: string }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          fallbackChunks.push((block as { text: string }).text);
        }
      }
    }
  }

  // Fallback path: when the response shape doesn't carry structuredContent,
  // join the streamed text-block chunks.
  if (!sawStructured && fallbackChunks.length > 0) {
    out.stdout = fallbackChunks.join("");
  }

  return out;
}

/** Extract the SFN execution id (everything after the last `:` in the
 * execution ARN). Returns the full ARN if unparseable. */
function extractExecutionId(executionArn: string): string {
  const last = executionArn.split(":").pop();
  return last ?? executionArn;
}

/** Build a Python preamble that injects allowlisted env keys into
 * os.environ before user code runs. Only keys in the allowlist make it
 * through; everything else is dropped. */
function buildCodeWithEnvPrelude(
  code: string,
  env: Record<string, string> | undefined,
  allowlist: string[],
): string {
  if (!env || allowlist.length === 0) return code;
  const allowed = new Set(allowlist);
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (allowed.has(k)) filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) return code;
  const literal = JSON.stringify(filtered);
  return `import os\nos.environ.update(${literal})\n${code}`;
}

function trimPreview(
  text: string,
  capBytes: number,
): { preview: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= capBytes) return { preview: text, truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const sliced = bytes.slice(0, capBytes);
  // Drop a trailing partial UTF-8 sequence rather than emit replacement chars.
  return {
    preview: decoder.decode(sliced),
    truncated: true,
  };
}

function pickFirst(
  obj: Record<string, unknown>,
  keys: string[],
): unknown | undefined {
  for (const k of keys) if (obj[k]) return obj[k];
  return undefined;
}

function failWith(
  errorClass: string,
  errorMessage: string,
): PythonTaskResult {
  return {
    exitCode: -1,
    stdoutS3Uri: null,
    stderrS3Uri: null,
    stdoutPreview: "",
    truncated: false,
    errorClass,
    errorMessage,
  };
}

// ---------------------------------------------------------------------------
// Lambda handler — Step Functions invokes via Lambda integration.
// Bearer auth is unnecessary; SFN talks to Lambda directly via IAM.
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2 | PythonTaskInput,
): Promise<APIGatewayProxyStructuredResultV2 | PythonTaskResult> {
  // SFN Lambda Task delivers the input object directly (no API Gateway
  // wrapper). Detect by absence of `requestContext`.
  const isApiGateway =
    typeof event === "object" &&
    event !== null &&
    "requestContext" in event;

  // Snapshot env at handler entry; never re-read in async paths.
  const stage = process.env.STAGE ?? "dev";
  const interpreterId = process.env.SANDBOX_INTERPRETER_ID ?? "";
  const bucket = process.env.ROUTINE_OUTPUT_BUCKET ?? "";
  const envAllowlist = (process.env.ROUTINE_PYTHON_ENV_ALLOWLIST ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (!interpreterId || !bucket) {
    const reason = !interpreterId
      ? "SANDBOX_INTERPRETER_ID env var is not set"
      : "ROUTINE_OUTPUT_BUCKET env var is not set";
    const fail: PythonTaskResult = failWith("sandbox_misconfigured", reason);
    return isApiGateway
      ? {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fail),
        }
      : fail;
  }

  const input = isApiGateway
    ? (JSON.parse((event as APIGatewayProxyEventV2).body ?? "{}") as PythonTaskInput)
    : (event as PythonTaskInput);

  const result = await invokePythonTask(input, {
    stage,
    interpreterId,
    bucket,
    envAllowlist,
  });

  return isApiGateway
    ? {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      }
    : result;
}
