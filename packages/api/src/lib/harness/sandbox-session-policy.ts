import { createHash } from "node:crypto";

export const HARNESS_SANDBOX_MAX_CODE_BYTES = 16 * 1024;
export const HARNESS_SANDBOX_MAX_FILES = 5;
export const HARNESS_SANDBOX_MAX_FILE_BYTES = 128 * 1024;
export const HARNESS_SANDBOX_SESSION_TIMEOUT_SECONDS = 120;

const OUTPUT_PATH = /^\/tmp\/thinkwork\/[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;

export interface HarnessSandboxRequest {
  code: string;
  language: "python";
  outputFiles: string[];
}

export interface HarnessSandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeSeconds: number | null;
  files: Array<{ path: string; text: string }>;
  truncated: boolean;
}

export class HarnessSandboxPolicyError extends Error {
  constructor(
    public readonly code:
      | "invalid_code"
      | "unsupported_language"
      | "invalid_output_file"
      | "too_many_output_files",
  ) {
    super(code);
    this.name = "HarnessSandboxPolicyError";
  }
}

export function validateHarnessSandboxRequest(input: {
  code?: unknown;
  language?: unknown;
  output_files?: unknown;
}): HarnessSandboxRequest {
  if (
    typeof input.code !== "string" ||
    input.code.trim().length === 0 ||
    Buffer.byteLength(input.code, "utf8") > HARNESS_SANDBOX_MAX_CODE_BYTES
  ) {
    throw new HarnessSandboxPolicyError("invalid_code");
  }
  if (input.language !== "python") {
    throw new HarnessSandboxPolicyError("unsupported_language");
  }
  const outputFiles = input.output_files ?? [];
  if (!Array.isArray(outputFiles)) {
    throw new HarnessSandboxPolicyError("invalid_output_file");
  }
  if (outputFiles.length > HARNESS_SANDBOX_MAX_FILES) {
    throw new HarnessSandboxPolicyError("too_many_output_files");
  }
  const normalized = outputFiles.map((path) => {
    if (
      typeof path !== "string" ||
      !OUTPUT_PATH.test(path) ||
      path.includes("..")
    ) {
      throw new HarnessSandboxPolicyError("invalid_output_file");
    }
    return path;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new HarnessSandboxPolicyError("invalid_output_file");
  }
  return { code: input.code, language: "python", outputFiles: normalized };
}

export function sanitizeHarnessSandboxResult(
  input: HarnessSandboxResult,
): HarnessSandboxResult {
  let remaining = HARNESS_SANDBOX_MAX_FILE_BYTES;
  let truncated = input.truncated;
  const take = (value: string): string => {
    if (remaining <= 0) {
      truncated ||= value.length > 0;
      return "";
    }
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= remaining) {
      remaining -= bytes.length;
      return value;
    }
    const sliced = bytes.subarray(0, remaining).toString("utf8");
    remaining = 0;
    truncated = true;
    return sliced;
  };
  return {
    stdout: take(input.stdout),
    stderr: take(input.stderr),
    exitCode: Number.isInteger(input.exitCode) ? input.exitCode : 1,
    executionTimeSeconds:
      typeof input.executionTimeSeconds === "number" &&
      Number.isFinite(input.executionTimeSeconds) &&
      input.executionTimeSeconds >= 0
        ? input.executionTimeSeconds
        : null,
    files: input.files.map((file) => ({
      path: file.path,
      text: take(file.text),
    })),
    truncated,
  };
}

export function sandboxSessionName(turnId: string, toolUseId: string): string {
  const suffix = createHash("sha256")
    .update(`${turnId}:${toolUseId}`)
    .digest("hex")
    .slice(0, 16);
  return `tw-${turnId.replace(/-/g, "").slice(0, 12)}-${suffix}`;
}

export function sandboxSessionAlias(sessionId: string): string {
  return `sandbox:${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}`;
}
