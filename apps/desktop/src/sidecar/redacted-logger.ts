import { redactPiDiagnosticLine } from "../main/pi-sidecar-session.js";
import { redactDiagnosticValue } from "../main/pi-sidecar-diagnostics.js";

export interface RedactedLogger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export function createRedactedLogger(
  logger: Pick<Console, "info" | "warn" | "error"> = console,
): RedactedLogger {
  function write(
    level: "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
  ): void {
    const suffix = extra
      ? ` ${JSON.stringify(redactDiagnosticValue(extra))}`
      : "";
    logger[level](`[pi-sidecar] ${redactPiDiagnosticLine(message + suffix)}`);
  }

  return {
    info: (message, extra) => write("info", message, extra),
    warn: (message, extra) => write("warn", message, extra),
    error: (message, extra) => write("error", message, extra),
  };
}
