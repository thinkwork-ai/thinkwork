import type { PiExtensionRuntimeDescriptor } from "@thinkwork/pi-runtime-core";

const MAX_RUNNER_INPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const SAFE_ENV_KEYS = new Set(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]);

export interface DynamicExtensionRunnerRequest {
  descriptor: PiExtensionRuntimeDescriptor;
  operation: "tool" | "hook";
  name: string;
  input: unknown;
  timeoutMs?: number;
}

export interface DynamicExtensionRunnerResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export function buildDynamicExtensionRunnerEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export function assertDynamicExtensionRunnerPayload(input: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (bytes > MAX_RUNNER_INPUT_BYTES) {
    throw new Error(
      `Dynamic extension runner payload exceeds ${MAX_RUNNER_INPUT_BYTES} bytes.`,
    );
  }
}

/**
 * Execution stays behind this boundary so reviewed artifacts are never imported
 * into the privileged AgentCore process. U6 registers proxy tools/hooks first;
 * executable artifact support can replace this body once a signed isolated
 * runner is available.
 */
export async function runDynamicExtension(
  request: DynamicExtensionRunnerRequest,
): Promise<DynamicExtensionRunnerResult> {
  const started = Date.now();
  try {
    assertDynamicExtensionRunnerPayload({
      operation: request.operation,
      name: request.name,
      input: request.input,
    });
    buildDynamicExtensionRunnerEnv();
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Dynamic extension runner timeout must be positive.");
    }
    return {
      ok: false,
      error:
        "Dynamic extension artifact execution is disabled until an isolated signed runner is configured.",
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}
