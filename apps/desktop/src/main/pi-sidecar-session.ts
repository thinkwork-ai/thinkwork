import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_SIDECAR_PROTOCOL_VERSION = "0.1.0";

export type PiSidecarParentMessage =
  | {
      type: "ping";
    }
  | {
      type: "start-turn";
      requestId: string;
      payload: unknown;
    }
  | {
      type: "cancel-turn";
      requestId: string;
    };

export function isPiSidecarParentMessage(
  message: unknown,
): message is PiSidecarParentMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as { type?: unknown; requestId?: unknown };
  if (candidate.type === "ping") return true;
  return (
    (candidate.type === "start-turn" || candidate.type === "cancel-turn") &&
    typeof candidate.requestId === "string"
  );
}

export type PiSidecarChildMessage =
  | {
      type: "ready";
      version: string;
    }
  | {
      type: "pong";
      version: string;
    }
  | {
      type: "turn-accepted";
      requestId: string;
    }
  | {
      type: "turn-cancelled";
      requestId: string;
    }
  | {
      type: "diagnostic";
      level: "info" | "warn" | "error";
      message: string;
    };

const SECRET_VALUE_RE =
  /((?:access[_-]?key|secret|session[_-]?token|authorization|finalize[_-]?callback[_-]?secret|api[_-]?key)[=:]\s*)[^\s,;]+/gi;
const AUTHORIZATION_BEARER_VALUE_RE =
  /(authorization[=:]\s*)bearer\s+[^\s,;]+/gi;
const BEARER_TOKEN_RE = /(bearer\s+)[a-z0-9._~+/=-]+/gi;
const AWS_KEY_RE = /AKIA[0-9A-Z]{16}/g;

export function resolvePiSidecarEntryPath(mainDir = currentMainDir()): string {
  return join(mainDir, "pi-sidecar.js");
}

export function redactPiDiagnosticLine(line: string): string {
  return line
    .replace(AUTHORIZATION_BEARER_VALUE_RE, "$1[redacted]")
    .replace(BEARER_TOKEN_RE, "$1[redacted]")
    .replace(SECRET_VALUE_RE, "$1[redacted]")
    .replace(AWS_KEY_RE, "[redacted-aws-key]");
}

function currentMainDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}
