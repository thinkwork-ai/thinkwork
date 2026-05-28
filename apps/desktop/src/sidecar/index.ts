import {
  PI_SIDECAR_PROTOCOL_VERSION,
  isPiSidecarParentMessage,
} from "../main/pi-sidecar-session.js";

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
        return;
      case "cancel-turn":
        parentPort.postMessage({
          type: "turn-cancelled",
          requestId: message.requestId,
        });
        return;
    }
  });
}
