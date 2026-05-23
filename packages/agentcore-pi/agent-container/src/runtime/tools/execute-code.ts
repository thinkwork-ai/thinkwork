import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { SandboxFactory, SessionEnv } from "@thinkwork/pi-aws";
import { Type } from "typebox";

const STDOUT_LIMIT_BYTES = 256 * 1024;
const STDERR_LIMIT_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 300_000;

function truncate(value: string, limit: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= limit) return { text: value, truncated: false };
  return {
    text: Buffer.from(value, "utf8").subarray(0, limit).toString("utf8"),
    truncated: true,
  };
}

function pythonCommandFor(code: string): string {
  const encoded = Buffer.from(code, "utf8").toString("base64");
  return [
    "python3 - <<'PY'",
    "import base64",
    `code = base64.b64decode("${encoded}").decode("utf-8")`,
    'exec(compile(code, "<thinkwork-execute-code>", "exec"))',
    "PY",
  ].join("\n");
}

export interface ExecuteCodeToolOptions {
  sandboxFactory: SandboxFactory;
  cleanup: Array<() => Promise<void>>;
  cwd?: string;
  timeoutMs?: number;
}

export function buildExecuteCodeTool(
  options: ExecuteCodeToolOptions,
): AgentTool<any> {
  let session: SessionEnv | null = null;

  async function getSession(): Promise<SessionEnv> {
    if (session) return session;
    session = await options.sandboxFactory.createSessionEnv({
      id: "pi-execute-code",
      cwd: options.cwd ?? "/home/user",
    });
    if (session.cleanup) {
      options.cleanup.push(() => session?.cleanup?.() ?? Promise.resolve());
    }
    return session;
  }

  return {
    name: "execute_code",
    label: "Code Interpreter",
    description:
      "Run Python code in the tenant's AgentCore Code Interpreter sandbox. " +
      "Use this for data analysis, calculations, and short scripts.",
    parameters: Type.Object({
      code: Type.String({
        description: "Python code to execute.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const code = String((params as { code?: unknown }).code ?? "");
      if (!code.trim()) {
        throw new Error("execute_code requires a non-empty `code` string.");
      }

      const env = await getSession();
      const started = Date.now();
      const result = await env.exec(pythonCommandFor(code), {
        cwd: env.cwd,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      const stdout = truncate(result.stdout ?? "", STDOUT_LIMIT_BYTES);
      const stderr = truncate(result.stderr ?? "", STDERR_LIMIT_BYTES);
      const summary = [
        `exit_code: ${result.exitCode}`,
        stdout.text ? `stdout:\n${stdout.text}` : "",
        stderr.text ? `stderr:\n${stderr.text}` : "",
        stdout.truncated ? "[stdout truncated]" : "",
        stderr.truncated ? "[stderr truncated]" : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        content: [{ type: "text", text: summary || "No output." }],
        details: {
          ok: result.exitCode === 0,
          exit_code: result.exitCode,
          exit_status: result.exitCode === 0 ? "ok" : "error",
          duration_ms: Date.now() - started,
          stdout: stdout.text,
          stderr: stderr.text,
          stdout_bytes: Buffer.byteLength(result.stdout ?? "", "utf8"),
          stderr_bytes: Buffer.byteLength(result.stderr ?? "", "utf8"),
          stdout_truncated: stdout.truncated,
          stderr_truncated: stderr.truncated,
          error: result.exitCode === 0 ? null : "SandboxError",
          error_message:
            result.exitCode === 0
              ? null
              : `Process exited with status ${result.exitCode}`,
          runtime: "pi",
        },
      };
    },
  };
}
