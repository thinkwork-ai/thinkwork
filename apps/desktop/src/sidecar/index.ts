import {
  PI_SIDECAR_PROTOCOL_VERSION,
  isPiSidecarParentMessage,
} from "../main/pi-sidecar-session.js";
import { runLocalDesktopTurn } from "./local-turn-runner.js";
import { createRedactedLogger } from "./redacted-logger.js";

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
}

const parentPort =
  (process as NodeJS.Process & { parentPort?: ParentPort | null }).parentPort ??
  null;

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
        parentPort.postMessage({
          type: "turn-accepted",
          requestId: message.requestId,
        });
        void runTurn(message.requestId, message.payload);
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
    try {
      const result = await runLocalDesktopTurn(payload, {
        signal: abortController.signal,
        logger,
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
      turns.delete(requestId);
    }
  }
}
