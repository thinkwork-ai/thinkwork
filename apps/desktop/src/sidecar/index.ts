import {
  PI_SIDECAR_PROTOCOL_VERSION,
  isPiSidecarParentMessage,
} from "../main/pi-sidecar-session.js";
import {
  prewarmLocalWorkspace,
  runLocalDesktopTurn,
} from "./local-turn-runner.js";
import { createRedactedLogger } from "./redacted-logger.js";

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort =
  (process as NodeJS.Process & { parentPort?: ParentPort | null }).parentPort ??
  null;
const DEFAULT_TURN_TIMEOUT_MS = 90_000;

if (!parentPort) {
  console.error("[pi-sidecar] missing Electron parentPort");
  process.exitCode = 1;
} else {
  const turns = new Map<string, AbortController>();
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
      case "cancel-turn":
        turns.get(message.requestId)?.abort();
        turns.delete(message.requestId);
        parentPort.postMessage({
          type: "turn-cancelled",
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
}

function resolveTurnTimeoutMs(): number {
  const raw = process.env.THINKWORK_DESKTOP_LOCAL_PI_TURN_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TURN_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TURN_TIMEOUT_MS;
}

function isLocalPiDebugEnabled(): boolean {
  const raw = process.env.THINKWORK_DESKTOP_LOCAL_PI_DEBUG;
  return raw === "1" || raw?.toLowerCase() === "true";
}
