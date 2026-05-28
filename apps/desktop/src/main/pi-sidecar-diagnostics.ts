import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PiSidecarState } from "@thinkwork/desktop-ipc";
import {
  PI_SIDECAR_PROTOCOL_VERSION,
  redactPiDiagnosticLine,
} from "./pi-sidecar-session.js";

export interface PiSidecarDiagnosticsOptions {
  userDataPath: string;
  appVersion: string;
  stage: string;
  runtimeEnabled: boolean;
  hostType: "development" | "packaged";
  now?: () => Date;
  maxBytes?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export interface PiSidecarDiagnosticsSnapshotInput {
  state: PiSidecarState;
  tenantId?: string | null;
  tenantSlug?: string | null;
  agentId?: string | null;
  agentSlug?: string | null;
  delegationDecision?: string | null;
}

export interface PiSidecarDiagnosticsSnapshot {
  runtime: {
    enabled: boolean;
    protocolVersion: string;
    appVersion: string;
    stage: string;
    hostType: "development" | "packaged";
  };
  sidecar: {
    status: PiSidecarState["status"];
    version: string | null;
    restartCount: number;
    lastExitCode: number | null;
    crashReason: string | null;
  };
  scope: {
    tenant: string | null;
    agent: string | null;
  };
  delegation: {
    decision: string | null;
  };
}

export class PiSidecarDiagnostics {
  readonly logPath: string;
  readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly options: Required<
    Pick<PiSidecarDiagnosticsOptions, "now" | "maxBytes" | "logger">
  > &
    Omit<PiSidecarDiagnosticsOptions, "now" | "maxBytes" | "logger">;

  constructor(options: PiSidecarDiagnosticsOptions) {
    this.options = {
      ...options,
      now: options.now ?? (() => new Date()),
      maxBytes: options.maxBytes ?? 256 * 1024,
      logger: options.logger ?? console,
    };
    this.logPath = join(
      options.userDataPath,
      "pi-diagnostics",
      "pi-sidecar.log",
    );
    this.logger = {
      info: (message: string, extra?: unknown) => {
        this.options.logger.info(redactPiDiagnosticLine(String(message)));
        void this.writeEvent("info", String(message), extra);
      },
      warn: (message: string, extra?: unknown) => {
        this.options.logger.warn(redactPiDiagnosticLine(String(message)));
        void this.writeEvent("warn", String(message), extra);
      },
      error: (message: string, extra?: unknown) => {
        this.options.logger.error(redactPiDiagnosticLine(String(message)));
        void this.writeEvent("error", String(message), extra);
      },
    };
  }

  snapshot(
    input: PiSidecarDiagnosticsSnapshotInput,
  ): PiSidecarDiagnosticsSnapshot {
    return {
      runtime: {
        enabled: this.options.runtimeEnabled,
        protocolVersion: PI_SIDECAR_PROTOCOL_VERSION,
        appVersion: this.options.appVersion,
        stage: this.options.stage,
        hostType: this.options.hostType,
      },
      sidecar: {
        status: input.state.status,
        version: input.state.version,
        restartCount: input.state.restartCount,
        lastExitCode: input.state.lastExitCode,
        crashReason: input.state.lastError?.message ?? null,
      },
      scope: {
        tenant: hashScope(input.tenantId ?? input.tenantSlug),
        agent: hashScope(input.agentId ?? input.agentSlug),
      },
      delegation: {
        decision: input.delegationDecision ?? null,
      },
    };
  }

  async writeEvent(
    level: "info" | "warn" | "error",
    message: string,
    extra?: unknown,
  ): Promise<void> {
    const line =
      redactPiDiagnosticLine(
        JSON.stringify({
          ts: this.options.now().toISOString(),
          level,
          message,
          extra: redactDiagnosticValue(extra),
        }),
      ) + "\n";
    await appendBounded(this.logPath, line, this.options.maxBytes);
  }
}

export function createPiSidecarDiagnostics(
  options: PiSidecarDiagnosticsOptions,
): PiSidecarDiagnostics {
  return new PiSidecarDiagnostics(options);
}

export function disabledPiSidecarState(now: Date = new Date()): PiSidecarState {
  return {
    status: "unavailable",
    pid: null,
    version: null,
    restartCount: 0,
    startedAt: null,
    updatedAt: now.toISOString(),
    lastExitCode: null,
    lastError: {
      code: "DISABLED",
      message: "Desktop local Pi is disabled for this stage",
    },
  };
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactPiDiagnosticLine(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      redactDiagnosticEntry(key, entry),
    ]),
  );
}

function redactDiagnosticEntry(key: string, value: unknown): unknown {
  if (isMessageKey(key)) return "[redacted-message]";
  if (isSecretKey(key)) return "[redacted]";
  if (isScopeKey(key)) return hashScope(stringValue(value));
  return redactDiagnosticValue(value);
}

function isSecretKey(key: string): boolean {
  return /token|secret|authorization|api[-_]?key|access[-_]?key|credential/i.test(
    key,
  );
}

function isMessageKey(key: string): boolean {
  return /^(message|userMessage|user_message|prompt|content)$/i.test(key);
}

function isScopeKey(key: string): boolean {
  return /^(tenantId|tenant_id|tenantSlug|tenant_slug|agentId|agent_id|agentSlug|agent_slug|assistantId|assistant_id|userId|user_id)$/i.test(
    key,
  );
}

function hashScope(value: string | null | undefined): string | null {
  if (!value) return null;
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function appendBounded(
  path: string,
  line: string,
  maxBytes: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const size = await fileSize(path);
  if (size + Buffer.byteLength(line) > maxBytes) {
    await trimDiagnosticFile(path, Math.floor(maxBytes / 2));
  }
  await appendFile(path, line, "utf8");
  if ((await fileSize(path)) > maxBytes) {
    await trimDiagnosticFile(path, maxBytes);
  }
}

async function trimDiagnosticFile(
  path: string,
  keepBytes: number,
): Promise<void> {
  const existing = await readFile(path, "utf8").catch(() => "");
  await writeFile(path, existing.slice(-Math.max(0, keepBytes)), "utf8");
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
