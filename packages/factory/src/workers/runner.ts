/**
 * Provider-runner interface (KTD-5) and provider-agnostic runner event types
 * (KTD-9).
 *
 * A ProviderRunner knows how to launch one disposable headless worker for one
 * run attempt, observe it, and classify its outcome. Implementations:
 * ClaudeRunner (U4), CodexRunner (U9). All platform contact goes through a
 * HostTransport so CI (Linux) can run every test with fakes or stubs.
 */

/**
 * Provider-agnostic signals extracted from a worker's structured output
 * stream. Per KTD-9, rate-limit/quota signals are classified separately from
 * errors so the daemon can divert to QuotaCooldown instead of the kill path.
 */
export type RunnerEventKind = "completion" | "rate-limit" | "error";

export interface RunnerEvent {
  kind: RunnerEventKind;
  /** For completion events: whether the provider reported success. */
  success?: boolean;
  /** Human-readable extract (error message, result snippet). */
  detail?: string;
}

/** Identity of the run attempt a worker is executing. */
export interface LaunchContext {
  attemptId: number;
  issueId: string;
  phase: string;
  attemptNumber: number;
}

export interface LaunchOptions {
  /** Per-phase model (never rely on a session default). */
  model: string;
  /** Worker cwd — the attempt's bootstrapped worktree. */
  cwd: string;
  /** Budget backstop in USD (KTD: caps are a runaway backstop, not the SLA). */
  budgetUsd?: number;
  /** Explicit per-phase env additions; merged into the scrubbed env ONLY. */
  extraEnv?: Record<string, string>;
}

/**
 * Opaque-but-inspectable handle to a launched worker. Everything needed to
 * re-observe the worker after a daemon restart is on the handle (and
 * persisted to the attempt row): pid, log path, pid sidecar path.
 */
export interface WorkerHandle {
  attemptId: number;
  pid: number;
  logPath: string;
  pidPath: string;
  cwd: string;
}

export interface RunnerResult {
  /** True when the worker process was observed to have exited. */
  exitObserved: boolean;
  /** True when the provider emitted a completion event. */
  completed: boolean;
  /** True when the completion event reported success. */
  success: boolean;
  /** True when a rate-limit/quota signal was seen (KTD-9 cooldown path). */
  rateLimited: boolean;
  events: RunnerEvent[];
}

export interface ResultOptions {
  /** Poll interval while waiting for exit. */
  pollMs?: number;
  /** Give up waiting after this long; result has exitObserved=false. */
  timeoutMs?: number;
}

export interface ProviderRunner {
  /** Launch a detached worker; resolves once the pid is captured. */
  launch(
    attempt: LaunchContext,
    prompt: string,
    opts: LaunchOptions,
  ): Promise<WorkerHandle>;
  /** Is the worker process still alive? */
  liveness(handle: WorkerHandle): Promise<boolean>;
  /** Last n lines of the worker's log. */
  logTail(handle: WorkerHandle, n: number): Promise<string>;
  /** Kill the worker's whole process GROUP. Returns false if already gone. */
  kill(handle: WorkerHandle): Promise<boolean>;
  /** Wait for exit (bounded) and classify the outcome from the log stream. */
  result(handle: WorkerHandle, opts?: ResultOptions): Promise<RunnerResult>;
}
