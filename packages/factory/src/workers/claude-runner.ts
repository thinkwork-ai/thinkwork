/**
 * ClaudeRunner — runs one CE phase as a disposable headless Claude Code
 * worker (KTD-5).
 *
 * Proven invocation (U1, claude v2.1.206; --verbose re-proven live at U4 on
 * v2.1.207 — `-p --output-format stream-json` refuses to run without it):
 *   <claudeBin> -p <prompt> --output-format stream-json --verbose
 *     --model <phase-model> --dangerously-skip-permissions
 *     [--max-budget-usd <backstop>]
 *
 * - `claudeBin` is an ABSOLUTE path from host config; never PATH resolution
 *   (launchd never sources shell rc).
 * - Workers get a SCRUBBED minimal environment (KTD-5 amendment): they never
 *   inherit the daemon's env or its Linear/Slack/SSH credentials.
 * - stream-json events land in the attempt's log at `<logsDir>/` with a pid
 *   sidecar next to the log (`.pid`), preserving the layout the legacy
 *   dispatcher's scripts/factory-status.sh reads.
 */

import { dirname, join } from "node:path";

import type {
  LaunchContext,
  LaunchOptions,
  ProviderRunner,
  ResultOptions,
  RunnerEvent,
  RunnerResult,
  WorkerHandle,
} from "./runner.js";
import type { HostTransport } from "./transport.js";

/** Env vars copied through from the daemon when set. Nothing else survives. */
const ENV_ALLOWLIST = ["HOME", "USER", "LOGNAME", "TMPDIR"] as const;

const SCRUBBED_PATH_BASE = "/usr/bin:/bin:/usr/sbin:/sbin";

export interface ScrubbedEnvInput {
  /** Directory of the worker binary; appended to the scrubbed PATH. */
  binDir: string;
  /** The attempt's worktree; becomes PWD. */
  worktreePath: string;
  /** Explicit per-phase additions ONLY — never a passthrough of daemon env. */
  extra?: Record<string, string>;
  /** Injectable for tests; defaults to process.env. */
  sourceEnv?: Record<string, string | undefined>;
}

/**
 * Build the minimal scrubbed worker environment (KTD-5 amendment): a
 * from-scratch PATH plus the binary's dir, the identity/tmp vars the CLI
 * needs, worktree-scoped vars, and explicit extras. The daemon's secrets
 * (Linear/Slack keys, SSH agent, cloud creds) are structurally absent.
 */
export function buildScrubbedEnv(
  input: ScrubbedEnvInput,
): Record<string, string> {
  const source =
    input.sourceEnv ?? (process.env as Record<string, string | undefined>);
  const env: Record<string, string> = {
    PATH: `${SCRUBBED_PATH_BASE}:${input.binDir}`,
    PWD: input.worktreePath,
  };
  for (const key of ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined && value !== "") env[key] = value;
  }
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    env[key] = value;
  }
  return env;
}

const RATE_LIMIT_PATTERN =
  /rate.?limit|usage limit reached|quota|overloaded|too many requests|\b429\b/i;

/**
 * Parse claude `stream-json` output into provider-agnostic runner events
 * (KTD-9). Unparseable lines are skipped; rate-limit/quota signals are
 * classified separately from plain errors so they divert to cooldown, not
 * the kill path.
 */
export function parseClaudeStreamEvents(logText: string): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  for (const line of logText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const obj = parsed as Record<string, unknown>;

    // Structured rate-limit telemetry (observed live on v2.1.207): the CLI
    // emits {"type":"rate_limit_event","rate_limit_info":{"status":"allowed",…}}
    // routinely on healthy runs. Only a non-allowed status is a quota signal;
    // never run the substring heuristic over these lines.
    if (obj.type === "rate_limit_event") {
      const info = obj.rate_limit_info as Record<string, unknown> | undefined;
      if (info && info.status !== "allowed") {
        events.push({ kind: "rate-limit", detail: trimmed.slice(0, 500) });
      }
      continue;
    }

    if (obj.type === "result") {
      const isError = obj.is_error === true || obj.subtype !== "success";
      // The substring heuristic runs ONLY on genuine error outcome lines —
      // never on assistant/tool content, where healthy transcripts in this
      // repo legitimately mention "quota"/"429" (budget & cost work).
      const rateLimited = isError && RATE_LIMIT_PATTERN.test(trimmed);
      if (rateLimited) {
        events.push({ kind: "rate-limit", detail: trimmed.slice(0, 500) });
      } else if (isError) {
        events.push({
          kind: "error",
          detail: String(obj.result ?? obj.subtype ?? "unknown error").slice(
            0,
            500,
          ),
        });
      }
      events.push({
        kind: "completion",
        success: !isError,
        detail:
          typeof obj.result === "string" ? obj.result.slice(0, 500) : undefined,
      });
    }
  }
  return events;
}

export interface ClaudeRunnerOptions {
  /** Absolute path to the claude binary (host config `claudeBin`). */
  claudeBin: string;
  /** Log directory, e.g. `~/.thinkwork-factory/logs`. */
  logsDir: string;
  transport: HostTransport;
  clock?: () => Date;
}

export class ClaudeRunner implements ProviderRunner {
  private readonly claudeBin: string;
  private readonly logsDir: string;
  private readonly transport: HostTransport;
  private readonly clock: () => Date;

  constructor(options: ClaudeRunnerOptions) {
    this.claudeBin = options.claudeBin;
    this.logsDir = options.logsDir;
    this.transport = options.transport;
    this.clock = options.clock ?? (() => new Date());
  }

  async launch(
    attempt: LaunchContext,
    prompt: string,
    opts: LaunchOptions,
  ): Promise<WorkerHandle> {
    const ts = this.clock().getTime();
    // Existing layout: <ISSUE_ID>-<phase>-<ts>.log with a .pid sidecar beside it.
    const logPath = join(
      this.logsDir,
      `${attempt.issueId}-${attempt.phase}-${ts}.log`,
    );
    const pidPath = logPath.replace(/\.log$/, ".pid");

    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      // Required by the CLI when combining --print with stream-json output
      // (observed live: "Error: When using --print, --output-format=stream-json
      // requires --verbose").
      "--verbose",
      "--model",
      opts.model,
      "--dangerously-skip-permissions",
    ];
    if (opts.budgetUsd !== undefined) {
      args.push("--max-budget-usd", String(opts.budgetUsd));
    }

    const env = buildScrubbedEnv({
      binDir: dirname(this.claudeBin),
      worktreePath: opts.cwd,
      extra: opts.extraEnv,
    });

    const { pid } = await this.transport.spawnDetached({
      command: this.claudeBin,
      args,
      env,
      cwd: opts.cwd,
      logPath,
    });
    await this.transport.writeFileText(pidPath, `${pid}\n`);

    return {
      attemptId: attempt.attemptId,
      pid,
      logPath,
      pidPath,
      cwd: opts.cwd,
    };
  }

  async liveness(handle: WorkerHandle): Promise<boolean> {
    return this.transport.pidAlive(handle.pid);
  }

  async logTail(handle: WorkerHandle, n: number): Promise<string> {
    return this.transport.readTail(handle.logPath, n);
  }

  async kill(handle: WorkerHandle): Promise<boolean> {
    return this.transport.killPidGroup(handle.pid, "SIGKILL");
  }

  async result(
    handle: WorkerHandle,
    opts: ResultOptions = {},
  ): Promise<RunnerResult> {
    const pollMs = opts.pollMs ?? 2_000;
    const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    const deadline = Date.now() + timeoutMs;

    let exitObserved = false;
    while (Date.now() < deadline) {
      if (!(await this.transport.pidAlive(handle.pid))) {
        exitObserved = true;
        break;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const logText = await this.transport.readFileText(handle.logPath);
    const events = parseClaudeStreamEvents(logText);
    const completion = events.find((e) => e.kind === "completion");
    return {
      exitObserved,
      completed: completion !== undefined,
      success: completion?.success === true,
      rateLimited: events.some((e) => e.kind === "rate-limit"),
      events,
    };
  }
}
