/**
 * routine-task-python — code recipe Task wrapper Lambda
 * (Plan 2026-05-01-005 §U6).
 *
 * Step Functions invokes this Lambda for every Python/TypeScript code recipe state in
 * a routine ASL. The wrapper:
 *
 *   1. Snapshots SANDBOX_INTERPRETER_ID, ROUTINE_OUTPUT_BUCKET, and
 *      ROUTINE_PYTHON_ENV_ALLOWLIST at handler entry. Subsequent re-reads
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
 *      failures degrade to console.warn + continue — AgentCore reaps
 *      idle sessions, but a stop_session error usually signals a control-
 *      plane issue worth investigating.
 *
 * The handler is **SFN-only** — no API Gateway code path. Step Functions
 * delivers the Task input directly via Lambda integration.
 *
 * Output shape:
 *   { exitCode, stdoutS3Uri, stderrS3Uri, stdoutPreview, truncated,
 *     errorClass?, errorMessage? }
 */

import {
  BedrockAgentCoreClient,
  type CodeInterpreterStreamOutput,
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  resolveRoutineCredentialBindings,
  type CredentialBindingInput,
  type ResolveRoutineCredentialBindingsInput,
  type ResolvedRoutineCredentials,
} from "./routine-credential-resolver.js";
import { createRoutineOutputRedactor } from "./routine-output-redactor.js";
import {
  postStepCallback,
  type StepCallbackEnv,
} from "./routine-step-callback-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PythonTaskInput {
  /** Tenant id. UUID-validated by the wrapper to prevent path traversal
   * when constructing the S3 key prefix. */
  tenantId: string;
  /** Step Functions execution id (the full ARN — `$$.Execution.Id` in
   * ASL Context). The S3 key uses the trailing segment of the ARN. */
  executionId: string;
  /** ASL state name. Used as the per-step S3 prefix. */
  nodeId: string;
  /** Code language. Defaults to python for old ASL payloads. */
  language?: "python" | "typescript";
  /** User code, verbatim. */
  code: string;
  /** Current Step Functions state input. Exposed to sandbox code as `input`. */
  input?: unknown;
  /** Optional caller-supplied env. Only keys in `envAllowlist` flow
   * through to the sandbox; other keys are silently dropped. */
  environment?: Record<string, string>;
  /** Tenant credential handles to expose to user code as `credentials`. */
  credentialBindings?: CredentialBindingInput[];
  /** Optional override for the 4KB preview cap; tests only. */
  previewCapBytes?: number;
  /** Hard timeout for the user code, in seconds. AgentCore enforces; the
   * wrapper passes through. Defaults to 300s. */
  timeoutSeconds?: number;
}

export interface PythonTaskOptions {
  /** AgentCore Code Interpreter id; resolved at handler entry from
   * `SANDBOX_INTERPRETER_ID`. Tests inject directly. */
  interpreterId: string;
  /** S3 bucket for offloaded output; resolved from
   * `ROUTINE_OUTPUT_BUCKET`. */
  bucket: string;
  /** Caller-supplied env keys allowed to pass through. Defaults to []. */
  envAllowlist?: string[];
  /** Routine step-callback env (THINKWORK_API_URL + API_AUTH_SECRET).
   * When omitted (e.g., unit tests), no callback fires. Production
   * lambda-api wires both env vars. Failure to POST never fails the
   * Task — see routine-step-callback-client.ts. */
  stepCallback?: StepCallbackEnv;
  credentialResolver?: (
    input: ResolveRoutineCredentialBindingsInput,
  ) => Promise<ResolvedRoutineCredentials>;
  agentCoreClient?: BedrockAgentCoreClient;
  s3Client?: S3Client;
  secretsManagerClient?: SecretsManagerClient;
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
/** Hard cap on accumulated text-block fallback content. Bounds memory
 * usage when AgentCore streams an unbounded `content[]` for a runaway
 * print loop. 1 MB matches the per-state-payload guidance. */
const FALLBACK_CHUNKS_MAX_BYTES = 1024 * 1024;

const _UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ASL state names are bounded to printable ASCII without `/` per Step
 * Functions docs; reject anything that could path-traverse the S3 key. */
const _NODE_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

// Module-scope clients so warm Lambda invocations reuse the TCP pool.
// requestTimeout caps each AWS API call so a stalled SFN/AgentCore
// connection cannot consume the entire 300s+ Lambda budget. The
// optional overrides in PythonTaskOptions still win for unit tests.
const _DEFAULT_AGENTCORE_CLIENT = new BedrockAgentCoreClient({
  requestHandler: { requestTimeout: 60_000, connectionTimeout: 5_000 },
});
const _DEFAULT_S3_CLIENT = new S3Client({
  requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
});
const _DEFAULT_SECRETS_CLIENT = new SecretsManagerClient({
  requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
});

// ---------------------------------------------------------------------------
// Pure entry point — exported for unit tests and the publish flow.
// ---------------------------------------------------------------------------

export async function invokePythonTask(
  input: PythonTaskInput,
  options: PythonTaskOptions,
): Promise<PythonTaskResult> {
  const { interpreterId, bucket, envAllowlist = [] } = options;
  const agentCore = options.agentCoreClient ?? _DEFAULT_AGENTCORE_CLIENT;
  const s3 = options.s3Client ?? _DEFAULT_S3_CLIENT;
  const secretsManager =
    options.secretsManagerClient ?? _DEFAULT_SECRETS_CLIENT;
  const language = input.language === "typescript" ? "typescript" : "python";

  // Defense in depth: the recipe catalog populates tenantId from
  // $$.Execution.Input, but a malicious / malformed ASL could feed a
  // non-UUID value that would land in a different tenant's S3 prefix
  // because the lambda-api role has bucket-wide PutObject. Reject early.
  if (!_UUID_RE.test(input.tenantId)) {
    return failWith(
      "invalid_tenant_id",
      `tenantId must be a UUID; received '${input.tenantId}'`,
    );
  }
  if (!_NODE_ID_RE.test(input.nodeId)) {
    return failWith(
      "invalid_node_id",
      `nodeId must match ${_NODE_ID_RE}; received '${input.nodeId}'`,
    );
  }

  const previewCap = input.previewCapBytes ?? DEFAULT_PREVIEW_CAP_BYTES;
  const sfnExecutionId = extractExecutionId(input.executionId);
  const keyPrefix = `${input.tenantId}/${sfnExecutionId}/${input.nodeId}`;

  // Step-callback fires before + after the sandbox invoke so the
  // run-detail UI sees the step transition `running → succeeded/failed`.
  // The handler resolves `executionArn` (full SFN execution ARN) to the
  // routine_executions row UUID, so the wrapper just forwards what
  // it has from the SFN Context (`$$.Execution.Id`).
  const stepCallback = options.stepCallback;
  const startedAt = new Date().toISOString();

  if (stepCallback) {
    // Fire-and-log on failure — telemetry must not fail the Task.
    await postStepCallback(stepCallback, {
      tenantId: input.tenantId,
      executionArn: input.executionId,
      nodeId: input.nodeId,
      recipeType: language,
      status: "running",
      startedAt,
    });
  }

  let resolvedCredentials: ResolvedRoutineCredentials;
  try {
    resolvedCredentials = await (
      options.credentialResolver ?? resolveRoutineCredentialBindings
    )({
      tenantId: input.tenantId,
      bindings: Array.isArray(input.credentialBindings)
        ? input.credentialBindings
        : [],
      secretsManager,
    });
  } catch (err) {
    const result = failWith(
      "credential_resolution_failed",
      (err as Error).message ?? "unknown",
    );
    await postTerminalStepCallback(input, {
      stepCallback,
      language,
      startedAt,
      result,
    });
    return result;
  }
  const redactor = createRoutineOutputRedactor([
    resolvedCredentials.credentials,
    resolvedCredentials.redactionValues,
  ]);

  // ---- 1. Start session ------------------------------------------------
  let sessionId: string;
  try {
    const start = await agentCore.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: interpreterId,
        sessionTimeoutSeconds: input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      }),
    );
    if (!start.sessionId) {
      const result = failWith(
        "sandbox_session_start_failed",
        "no sessionId returned",
      );
      await postTerminalStepCallback(input, {
        stepCallback,
        language,
        startedAt,
        result,
      });
      return result;
    }
    sessionId = start.sessionId;
  } catch (err) {
    const result = failWith(
      "sandbox_session_start_failed",
      (err as Error).message ?? "unknown",
    );
    await postTerminalStepCallback(input, {
      stepCallback,
      language,
      startedAt,
      result,
    });
    return result;
  }

  // ---- 2 + 3. Invoke + parse stream + 4. Stop --------------------------
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let invokeErrorClass: string | undefined;
  let invokeErrorMessage: string | undefined;

  try {
    const codeWithEnv = buildCodeWithEnvPrelude(
      input.code,
      input.environment,
      envAllowlist,
      language,
      resolvedCredentials.credentials,
      input.input,
    );
    const invoke = await agentCore.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: interpreterId,
        sessionId,
        name: "executeCode",
        arguments: {
          code: codeWithEnv,
          language,
        },
      }),
    );

    const parsed = await parseStream(invoke);
    stdout = redactor.redact(parsed.stdout);
    stderr = redactor.redact(parsed.stderr);
    exitCode = parsed.exitCode;
    invokeErrorClass = parsed.errorClass;
    invokeErrorMessage = redactor.redact(parsed.errorMessage);
  } catch (err) {
    invokeErrorClass = "sandbox_invoke_failed";
    invokeErrorMessage = redactor.redact((err as Error).message ?? "unknown");
    exitCode = -1;
  } finally {
    try {
      await agentCore.send(
        new StopCodeInterpreterSessionCommand({
          codeInterpreterIdentifier: interpreterId,
          sessionId,
        }),
      );
    } catch (stopErr) {
      // Log-and-continue: AgentCore reaps idle sessions, but a stop
      // failure is unusual enough to warrant surfacing in CloudWatch so
      // operators can correlate orphaned-session alarms.
      console.warn(
        `[routine-task-python] StopCodeInterpreterSession failed for session=${sessionId}: ${(stopErr as Error).message}`,
      );
    }
  }

  if (invokeErrorClass) {
    const result: PythonTaskResult = {
      exitCode: -1,
      stdoutS3Uri: null,
      stderrS3Uri: null,
      stdoutPreview: "",
      truncated: false,
      errorClass: invokeErrorClass,
      errorMessage: redactor.redact(invokeErrorMessage),
    };
    await postTerminalStepCallback(input, {
      stepCallback,
      language,
      startedAt,
      result,
    });
    return result;
  }

  // ---- 5. S3 offload ---------------------------------------------------
  // Promise.allSettled so a single-leg failure (e.g., stderr was empty
  // and got rate-limited) doesn't mask the success of the other leg.
  // Operators looking at S3 should see whichever logs were actually
  // written, with errorClass surfacing on partial failure.
  const stdoutKey = `${keyPrefix}/stdout.log`;
  const stderrKey = `${keyPrefix}/stderr.log`;
  const [stdoutPut, stderrPut] = await Promise.allSettled([
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: stdoutKey,
        Body: redactor.redact(stdout),
        ContentType: "text/plain; charset=utf-8",
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: stderrKey,
        Body: redactor.redact(stderr),
        ContentType: "text/plain; charset=utf-8",
      }),
    ),
  ]);
  const stdoutOk = stdoutPut.status === "fulfilled";
  const stderrOk = stderrPut.status === "fulfilled";
  const s3PartialFailure = !stdoutOk || !stderrOk;
  if (s3PartialFailure) {
    const reasons: string[] = [];
    if (!stdoutOk)
      reasons.push(
        `stdout: ${redactor.redact((stdoutPut as PromiseRejectedResult).reason?.message ?? "unknown")}`,
      );
    if (!stderrOk)
      reasons.push(
        `stderr: ${redactor.redact((stderrPut as PromiseRejectedResult).reason?.message ?? "unknown")}`,
      );
    console.warn(
      `[routine-task-python] S3 offload partial failure for ${keyPrefix}: ${reasons.join("; ")}`,
    );
  }

  const { preview, truncated } = trimPreview(
    redactor.redact(stdout),
    previewCap,
  );

  const result: PythonTaskResult = {
    exitCode,
    stdoutS3Uri: stdoutOk ? `s3://${bucket}/${stdoutKey}` : null,
    stderrS3Uri: stderrOk ? `s3://${bucket}/${stderrKey}` : null,
    stdoutPreview: preview,
    truncated,
    ...(s3PartialFailure
      ? {
          errorClass: "s3_offload_failed",
          errorMessage:
            stdoutOk && !stderrOk
              ? "stderr S3 PutObject failed"
              : !stdoutOk && stderrOk
                ? "stdout S3 PutObject failed"
                : "S3 PutObject failed",
        }
      : {}),
  };

  await postTerminalStepCallback(input, {
    stepCallback,
    language,
    startedAt,
    result,
  });

  return result;
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

async function parseStream(response: {
  stream?: AsyncIterable<CodeInterpreterStreamOutput>;
}): Promise<ParsedStream> {
  const out: ParsedStream = { stdout: "", stderr: "", exitCode: 0 };
  if (!response.stream) return out;

  const fallbackChunks: string[] = [];
  let fallbackBytes = 0;
  let sawStructured = false;
  let sawAnyStdoutOrStderr = false;
  let sawExplicitExitCode = false;

  for await (const event of response.stream) {
    // Error envelopes the SDK surfaces inline as $UnknownMember-shaped
    // discriminated union members. Treat any of these as a hard failure;
    // the caller turns them into sandbox_invoke_failed.
    if ("internalServerException" in event && event.internalServerException) {
      return errorEnvelopeToParsed(event.internalServerException.message);
    }
    if ("throttlingException" in event && event.throttlingException) {
      return errorEnvelopeToParsed(event.throttlingException.message);
    }
    if ("validationException" in event && event.validationException) {
      return errorEnvelopeToParsed(event.validationException.message);
    }
    if ("accessDeniedException" in event && event.accessDeniedException) {
      return errorEnvelopeToParsed(event.accessDeniedException.message);
    }
    if ("conflictException" in event && event.conflictException) {
      return errorEnvelopeToParsed(event.conflictException.message);
    }
    if (
      "resourceNotFoundException" in event &&
      event.resourceNotFoundException
    ) {
      return errorEnvelopeToParsed(event.resourceNotFoundException.message);
    }
    if (
      "serviceQuotaExceededException" in event &&
      event.serviceQuotaExceededException
    ) {
      return errorEnvelopeToParsed(event.serviceQuotaExceededException.message);
    }

    if (!("result" in event) || !event.result) continue;
    const result = event.result;

    const structured = result.structuredContent;
    if (structured) {
      sawStructured = true;
      if (typeof structured.stdout === "string") {
        out.stdout = structured.stdout;
        sawAnyStdoutOrStderr ||= structured.stdout.length > 0;
      }
      if (typeof structured.stderr === "string") {
        out.stderr = structured.stderr;
        sawAnyStdoutOrStderr ||= structured.stderr.length > 0;
      }
      if (typeof structured.exitCode === "number") {
        out.exitCode = structured.exitCode;
        sawExplicitExitCode = true;
      }
    }

    const content = result.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          // Bounded accumulation — a runaway print loop in user code can
          // emit unbounded text-blocks; cap memory at 1 MB.
          if (fallbackBytes < FALLBACK_CHUNKS_MAX_BYTES) {
            fallbackChunks.push(block.text);
            fallbackBytes += block.text.length;
          }
        }
      }
    }
  }

  // Fallback path: when the response shape doesn't carry structuredContent,
  // join the streamed text-block chunks.
  if (!sawStructured && fallbackChunks.length > 0) {
    out.stdout = fallbackChunks.join("");
  }

  // Disambiguate the "process ran, exitCode wasn't reported" case. If the
  // sandbox produced stderr but didn't surface an exitCode, default to 1
  // so SFN sees the failure rather than a green step. structuredContent
  // with explicit exitCode=0 still wins.
  if (!sawExplicitExitCode && out.stderr.length > 0 && sawAnyStdoutOrStderr) {
    out.exitCode = 1;
  }

  return out;
}

function errorEnvelopeToParsed(message: string | undefined): ParsedStream {
  return {
    stdout: "",
    stderr: "",
    exitCode: -1,
    errorClass: "sandbox_invoke_failed",
    errorMessage: message ?? "AgentCore returned an error event",
  };
}

async function postTerminalStepCallback(
  input: PythonTaskInput,
  args: {
    stepCallback: StepCallbackEnv | undefined;
    language: "python" | "typescript";
    startedAt: string;
    result: PythonTaskResult;
  },
): Promise<void> {
  if (!args.stepCallback) return;
  const status: "succeeded" | "failed" =
    args.result.exitCode === 0 && !args.result.errorClass
      ? "succeeded"
      : "failed";
  await postStepCallback(args.stepCallback, {
    tenantId: input.tenantId,
    executionArn: input.executionId,
    nodeId: input.nodeId,
    recipeType: args.language,
    status,
    startedAt: args.startedAt,
    finishedAt: new Date().toISOString(),
    stdoutS3Uri: args.result.stdoutS3Uri ?? undefined,
    stderrS3Uri: args.result.stderrS3Uri ?? undefined,
    stdoutPreview: args.result.stdoutPreview,
    truncated: args.result.truncated,
    errorJson: args.result.errorClass
      ? {
          errorClass: args.result.errorClass,
          errorMessage: args.result.errorMessage,
        }
      : undefined,
  });
}

/** Extract the SFN execution id (everything after the last `:` in the
 * execution ARN). Returns the full ARN if unparseable. */
function extractExecutionId(executionArn: string): string {
  const last = executionArn.split(":").pop();
  return last ?? executionArn;
}

/** Build a Python preamble that injects allowlisted env keys into
 * os.environ before user code runs. Only keys in the allowlist make it
 * through; everything else is dropped.
 *
 * The prelude is appended *after* any `from __future__ import` lines at
 * the top of the user's code — Python requires those to appear before
 * any other statements, so naively prepending `import os` ahead of them
 * would break any user file that uses future imports. */
function buildCodeWithEnvPrelude(
  code: string,
  env: Record<string, string> | undefined,
  allowlist: string[],
  language: "python" | "typescript" = "python",
  credentials: Record<string, Record<string, unknown>> = {},
  executionInput?: unknown,
): string {
  const allowed = new Set(allowlist);
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    if (allowed.has(k)) filtered[k] = v;
  }
  const hasExecutionInput = executionInput !== undefined;
  if (
    Object.keys(filtered).length === 0 &&
    Object.keys(credentials).length === 0 &&
    !hasExecutionInput
  ) {
    return code;
  }
  if (language === "typescript") {
    const envLiteral = JSON.stringify(filtered);
    const credentialsLiteral = JSON.stringify(credentials);
    const inputLiteral = JSON.stringify(executionInput ?? null);
    const prelude =
      `const credentials = ${credentialsLiteral};\n` +
      `const input = ${inputLiteral};\n` +
      `const __thinkworkEnv = ${envLiteral};\n` +
      `if (typeof process !== "undefined" && process.env) Object.assign(process.env, __thinkworkEnv);\n`;
    return prelude + code;
  }
  const envLiteral = JSON.stringify(JSON.stringify(filtered));
  const credentialsLiteral = JSON.stringify(JSON.stringify(credentials));
  const inputLiteral = JSON.stringify(JSON.stringify(executionInput ?? null));
  const prelude = `import json\nimport os\ncredentials = json.loads(${credentialsLiteral})\ninput = json.loads(${inputLiteral})\nos.environ.update(json.loads(${envLiteral}))\n`;

  // Skip past any leading `from __future__ import ...` lines (and
  // surrounding blank lines / comments). Future imports MUST be first.
  const lines = code.split("\n");
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("from __future__ import")) {
      insertAt = i + 1;
      continue;
    }
    break;
  }
  if (insertAt === 0) return prelude + code;
  return [
    ...lines.slice(0, insertAt),
    prelude.trimEnd(),
    ...lines.slice(insertAt),
  ].join("\n");
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

function failWith(errorClass: string, errorMessage: string): PythonTaskResult {
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
// SFN delivers the Task input directly; no API Gateway path is wired,
// and the handler is intentionally not exposed as an HTTP route.
// ---------------------------------------------------------------------------

export async function handler(
  event: PythonTaskInput,
): Promise<PythonTaskResult> {
  // Snapshot env at handler entry; never re-read in async paths
  // (per feedback_completion_callback_snapshot_pattern).
  const interpreterId = process.env.SANDBOX_INTERPRETER_ID ?? "";
  const bucket = process.env.ROUTINE_OUTPUT_BUCKET ?? "";
  const envAllowlist = (process.env.ROUTINE_PYTHON_ENV_ALLOWLIST ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const stepCallback: StepCallbackEnv | undefined =
    process.env.THINKWORK_API_URL && process.env.API_AUTH_SECRET
      ? {
          apiUrl: process.env.THINKWORK_API_URL,
          authSecret: process.env.API_AUTH_SECRET,
        }
      : undefined;

  if (!interpreterId || !bucket) {
    return failWith(
      "sandbox_misconfigured",
      !interpreterId
        ? "SANDBOX_INTERPRETER_ID env var is not set"
        : "ROUTINE_OUTPUT_BUCKET env var is not set",
    );
  }

  return invokePythonTask(event, {
    interpreterId,
    bucket,
    envAllowlist,
    stepCallback,
  });
}
