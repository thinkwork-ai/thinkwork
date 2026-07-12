/**
 * Minimal structured JSON-lines logger. One JSON object per line on stdout:
 * { ts, level, component, msg, ...fields }. No external deps; the clock is
 * injectable so tests get deterministic timestamps.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export interface LoggerOptions {
  component?: string;
  /** Injectable clock for tests. Defaults to Date.now-based ISO timestamps. */
  clock?: () => Date;
  /** Injectable sink for tests. Defaults to process.stdout. */
  write?: (line: string) => void;
  /** Minimum level emitted. Defaults to "info" (or $FACTORY_LOG_LEVEL). */
  level?: LogLevel;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const env = process.env.FACTORY_LOG_LEVEL;
  if (env === "debug" || env === "info" || env === "warn" || env === "error")
    return env;
  return "info";
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const component = options.component ?? "factoryd";
  const clock = options.clock ?? (() => new Date());
  const write =
    options.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const minLevel = LEVEL_ORDER[resolveLevel(options.level)];

  function emit(
    level: LogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < minLevel) return;
    const record: Record<string, unknown> = {
      ts: clock().toISOString(),
      level,
      component,
      msg,
      ...fields,
    };
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      // Circular / unserializable fields — log the message without them.
      line = JSON.stringify({
        ts: clock().toISOString(),
        level,
        component,
        msg,
      });
    }
    write(line);
  }

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (childComponent: string) =>
      createLogger({ ...options, component: `${component}.${childComponent}` }),
  };
}
