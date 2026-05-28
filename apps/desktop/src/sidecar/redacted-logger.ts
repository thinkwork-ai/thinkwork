import { redactPiDiagnosticLine } from "../main/pi-sidecar-session.js";

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
    const suffix = extra ? ` ${JSON.stringify(redactRecord(extra))}` : "";
    logger[level](`[pi-sidecar] ${redactPiDiagnosticLine(message + suffix)}`);
  }

  return {
    info: (message, extra) => write("info", message, extra),
    warn: (message, extra) => write("warn", message, extra),
    error: (message, extra) => write("error", message, extra),
  };
}

function redactRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRecord);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSecretKey(key) ? "[redacted]" : redactRecord(entry),
    ]),
  );
}

function isSecretKey(key: string): boolean {
  return /token|secret|authorization|api[-_]?key|access[-_]?key/i.test(key);
}
