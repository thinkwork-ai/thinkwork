import {
  PI_SIDECAR_PROTOCOL_VERSION,
  isPiSidecarParentMessage,
} from "../main/pi-sidecar-session.js";
import {
  prewarmLocalWorkspace,
  runLocalDesktopTurn,
} from "./local-turn-runner.js";
import { runDesktopEvalRun } from "./eval-runner.js";
import { createRedactedLogger } from "./redacted-logger.js";

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort =
  (process as NodeJS.Process & { parentPort?: ParentPort | null }).parentPort ??
  null;
const DEFAULT_TURN_TIMEOUT_MS = 90_000;
const DEFAULT_EVAL_CONCURRENCY = 8;

if (!parentPort) {
  console.error("[pi-sidecar] missing Electron parentPort");
  process.exitCode = 1;
} else {
  const turns = new Map<string, AbortController>();
  const evalRuns = new Map<string, AbortController>();
  const logger = createRedactedLogger();

  parentPort.postMessage({
    type: "ready",
    version: PI_SIDECAR_PROTOCOL_VERSION,
  });
  parentPort.on("message", (event) => {
    const message = event.data;
    if (!isPiSidecarParentMessage(message)) return;
    switch (message.type) {
      case "ping":
        parentPort.postMessage({
          type: "pong",
          version: PI_SIDECAR_PROTOCOL_VERSION,
        });
        return;
      case "start-turn":
        logger.info("local Pi sidecar received turn", {
          requestId: message.requestId,
          threadTurnId: message.payload.session.threadTurnId,
        });
        parentPort.postMessage({
          type: "turn-accepted",
          requestId: message.requestId,
        });
        void runTurn(message.requestId, message.payload);
        return;
      case "prewarm-workspace":
        logger.info("local Pi sidecar received workspace prewarm", {
          requestId: message.requestId,
          agentSlug: message.payload.session.partition.agentSlug,
          spaceId: message.payload.session.partition.spaceId,
        });
        parentPort.postMessage({
          type: "workspace-prewarm-accepted",
          requestId: message.requestId,
        });
        void prewarmWorkspace(message.requestId, message.payload);
        return;
      case "start-eval-run":
        logger.info("local Pi sidecar received eval run", {
          requestId: message.requestId,
          runId: message.payload.runId,
          totalTests: message.payload.workItems.length,
        });
        parentPort.postMessage({
          type: "eval-run-accepted",
          requestId: message.requestId,
          runId: message.payload.runId,
          totalTests: message.payload.workItems.length,
        });
        void runEvalRun(message.requestId, message.payload);
        return;
      case "cancel-turn":
        turns.get(message.requestId)?.abort();
        turns.delete(message.requestId);
        parentPort.postMessage({
          type: "turn-cancelled",
          requestId: message.requestId,
        });
        return;
      case "cancel-eval-run":
        evalRuns.get(message.requestId)?.abort();
        evalRuns.delete(message.requestId);
        parentPort.postMessage({
          type: "eval-run-cancelled",
          requestId: message.requestId,
        });
        return;
    }
  });

  async function runTurn(
    requestId: string,
    payload: Parameters<typeof runLocalDesktopTurn>[0],
  ): Promise<void> {
    const abortController = new AbortController();
    turns.set(requestId, abortController);
    const timeoutMs = resolveTurnTimeoutMs();
    const timeout = setTimeout(() => {
      logger.warn("local Pi turn watchdog timeout", {
        requestId,
        timeoutMs,
      });
      abortController.abort();
    }, timeoutMs);
    try {
      const result = await runLocalDesktopTurn(payload, {
        signal: abortController.signal,
        logger,
        turnTimeoutMs: timeoutMs,
        debug: isLocalPiDebugEnabled(),
      });
      parentPort?.postMessage({
        type: "diagnostic",
        level: result.status === "completed" ? "info" : "warn",
        message: `turn ${requestId} ${result.status}; finalized=${result.finalized}`,
      });
    } catch (error) {
      parentPort?.postMessage({
        type: "diagnostic",
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : `local turn failed: ${String(error)}`,
      });
    } finally {
      clearTimeout(timeout);
      turns.delete(requestId);
    }
  }

  async function prewarmWorkspace(
    requestId: string,
    payload: Parameters<typeof prewarmLocalWorkspace>[0],
  ): Promise<void> {
    try {
      const result = await prewarmLocalWorkspace(payload, { logger });
      parentPort?.postMessage({
        type: "diagnostic",
        level: "info",
        message: `workspace prewarm ${requestId} completed; synced=${result.synced}; cacheHit=${result.cacheHit === true}`,
      });
    } catch (error) {
      parentPort?.postMessage({
        type: "diagnostic",
        level: "warn",
        message:
          error instanceof Error
            ? `workspace prewarm failed: ${error.message}`
            : `workspace prewarm failed: ${String(error)}`,
      });
    }
  }

  async function runEvalRun(
    requestId: string,
    payload: Parameters<typeof runDesktopEvalRun>[0],
  ): Promise<void> {
    const abortController = new AbortController();
    evalRuns.set(requestId, abortController);
    try {
      const result = await runDesktopEvalRun(payload, {
        signal: abortController.signal,
        logger,
        turnTimeoutMs: resolveTurnTimeoutMs(),
        evalConcurrency: resolveEvalConcurrency(),
        debug: isLocalPiDebugEnabled(),
      });
      parentPort?.postMessage({
        type: "diagnostic",
        level: result.cancelled ? "warn" : "info",
        message: `eval run ${requestId} completed=${result.completed}; failed=${result.failed}; cancelled=${result.cancelled}`,
      });
    } catch (error) {
      parentPort?.postMessage({
        type: "diagnostic",
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : `desktop eval run failed: ${String(error)}`,
      });
    } finally {
      evalRuns.delete(requestId);
    }
  }
}

function resolveTurnTimeoutMs(): number {
  const raw = process.env.THINKWORK_DESKTOP_LOCAL_PI_TURN_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TURN_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TURN_TIMEOUT_MS;
}

function resolveEvalConcurrency(): number {
  const raw = process.env.THINKWORK_DESKTOP_EVAL_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_EVAL_CONCURRENCY;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(8, parsed)
    : DEFAULT_EVAL_CONCURRENCY;
}

function isLocalPiDebugEnabled(): boolean {
  const raw = process.env.THINKWORK_DESKTOP_LOCAL_PI_DEBUG;
  return raw === "1" || raw?.toLowerCase() === "true";
}
