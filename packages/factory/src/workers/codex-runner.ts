/**
 * CodexRunner — runs one CE phase as a disposable headless Codex worker
 * (U9, scoped v1: the VERIFICATION phase, operator decision 2026-07-13 —
 * Codex is stronger at computer use, and verification drives a real browser
 * against deployed dev).
 *
 * Proven invocation (codex-cli 0.144.1):
 *   <codexBin> exec <prompt> --json -C <worktree> -m <model>
 *     --dangerously-bypass-approvals-and-sandbox
 *
 * - `codexBin` is an ABSOLUTE path from host config (launchd never sources
 *   shell rc).
 * - The user's ~/.codex/config.toml is DELIBERATELY honored (not
 *   --ignore-user-config): it carries the computer-use notify hook and the
 *   priority service tier the verification flow depends on. Auth resolves
 *   via HOME → ~/.codex, which the scrubbed env preserves.
 * - `--json` JSONL events land in the attempt's log with a `.pid` sidecar,
 *   same layout as ClaudeRunner (factory-status.sh compatible).
 * - Codex has no --max-budget-usd equivalent; LaunchOptions.budgetUsd is
 *   ignored (the wall-clock SLA is the backstop).
 *
 * Result classification is deliberately conservative: the factory's REAL
 * completion signal is Linear evidence (status move / baton / merged PR),
 * not runner self-reporting — driveAttempt only uses these events for the
 * rate-limit → QuotaCooldown diversion and legibility.
 */

import { dirname, join } from "node:path";

import { buildScrubbedEnv } from "./claude-runner.js";
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

const RATE_LIMIT_PATTERN =
  /rate.?limit|usage limit reached|quota|too many requests|\b429\b/i;

/**
 * Parse `codex exec --json` JSONL output into provider-agnostic runner
 * events. Schema-tolerant across codex versions: completion is any
 * `turn.completed`/`task_complete`-shaped event type; error events carry
 * `error` in the type (rate-limit text diverts to cooldown, like Claude's
 * parser). Unparseable lines are skipped.
 */
export function parseCodexJsonEvents(logText: string): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  let sawError = false;
  let completionDetail: string | undefined;
  let sawCompletion = false;

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
    // Events arrive either flat ({"type": ...}) or wrapped ({"msg": {"type": ...}}).
    const inner =
      typeof obj.msg === "object" && obj.msg !== null
        ? (obj.msg as Record<string, unknown>)
        : obj;
    const type = typeof inner.type === "string" ? inner.type : "";

    if (/error/i.test(type)) {
      const detail = String(inner.message ?? trimmed).slice(0, 500);
      if (RATE_LIMIT_PATTERN.test(detail)) {
        events.push({ kind: "rate-limit", detail });
      } else {
        events.push({ kind: "error", detail });
        sawError = true;
      }
      continue;
    }

    // Terminal turn/task completion across codex JSONL schema versions.
    if (/^(turn|task)[._-]?(complete|completed)$/i.test(type)) {
      sawCompletion = true;
      continue;
    }

    // The final agent message is the most useful completion detail.
    if (type === "item.completed" || type === "agent_message") {
      const item =
        typeof inner.item === "object" && inner.item !== null
          ? (inner.item as Record<string, unknown>)
          : inner;
      if (item.type === "agent_message" || type === "agent_message") {
        const text = item.text ?? item.message;
        if (typeof text === "string") completionDetail = text.slice(0, 500);
      }
    }
  }

  if (sawCompletion) {
    events.push({
      kind: "completion",
      success: !sawError,
      detail: completionDetail,
    });
  }
  return events;
}

export interface CodexRunnerOptions {
  /** Absolute path to the codex binary (host config `codexBin`). */
  codexBin: string;
  /** Log directory, e.g. `~/.thinkwork-factory/logs`. */
  logsDir: string;
  transport: HostTransport;
  clock?: () => Date;
}

export class CodexRunner implements ProviderRunner {
  private readonly codexBin: string;
  private readonly logsDir: string;
  private readonly transport: HostTransport;
  private readonly clock: () => Date;

  constructor(options: CodexRunnerOptions) {
    this.codexBin = options.codexBin;
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
    const logPath = join(
      this.logsDir,
      `${attempt.issueId}-${attempt.phase}-${ts}.log`,
    );
    const pidPath = logPath.replace(/\.log$/, ".pid");

    const args = [
      "exec",
      prompt,
      "--json",
      "-C",
      opts.cwd,
      "-m",
      opts.model,
      "--dangerously-bypass-approvals-and-sandbox",
    ];

    const env = buildScrubbedEnv({
      binDir: dirname(this.codexBin),
      worktreePath: opts.cwd,
      extra: opts.extraEnv,
    });

    const { pid } = await this.transport.spawnDetached({
      command: this.codexBin,
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
    const events = parseCodexJsonEvents(logText);
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
