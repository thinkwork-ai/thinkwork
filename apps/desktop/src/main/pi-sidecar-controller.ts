import { BrowserWindow, utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import {
  PI_DIAGNOSTIC_EVENT_CHANNEL,
  PI_STATUS_EVENT_CHANNEL,
  type PiDiagnosticEvent,
  type PiCancelTurnRequest,
  type PiCancelTurnResponse,
  type PiSidecarState,
  type PiStartTurnRequest,
  type PiStartTurnResponse,
} from "@thinkwork/desktop-ipc";
import {
  PI_SIDECAR_PROTOCOL_VERSION,
  redactPiDiagnosticLine,
  resolvePiSidecarEntryPath,
  type PiSidecarTurnPayload,
  type PiSidecarChildMessage,
  type PiSidecarParentMessage,
} from "./pi-sidecar-session.js";
import type { PreparePiRuntimeSession } from "./pi-runtime-session-client.js";

export interface UtilityProcessLike {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  postMessage(message: unknown): void;
  kill(): boolean;
  on(event: "spawn", listener: () => void): this;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(
    event: "error",
    listener: (type: string, location: string, report: string) => void,
  ): this;
}

export interface UtilityProcessFork {
  (
    modulePath: string,
    args?: string[],
    options?: {
      serviceName?: string;
      stdio?: Array<"ignore" | "pipe">;
    },
  ): UtilityProcessLike;
}

export interface PiSidecarControllerOptions {
  sidecarPath?: string;
  fork?: UtilityProcessFork;
  getWindows?: () => BrowserWindow[];
  now?: () => Date;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  restartDelayMs?: number;
  maxRestarts?: number;
  prepareTurn?: PreparePiRuntimeSession;
  workspaceCacheRoot?: string;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class PiSidecarController {
  private readonly sidecarPath: string;
  private readonly fork: UtilityProcessFork;
  private readonly getWindows: () => BrowserWindow[];
  private readonly now: () => Date;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly restartDelayMs: number;
  private readonly maxRestarts: number;
  private readonly prepareTurn: PreparePiRuntimeSession;
  private readonly workspaceCacheRoot: string;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly activeTurns = new Map<
    string,
    {
      threadId: string;
      threadTurnId: string | null;
    }
  >();
  private process: UtilityProcessLike | null = null;
  private restartTimer: unknown = null;
  private stopping = false;
  private state: PiSidecarState;

  constructor(options: PiSidecarControllerOptions = {}) {
    this.sidecarPath = options.sidecarPath ?? resolvePiSidecarEntryPath();
    this.fork = options.fork ?? utilityProcess.fork;
    this.getWindows =
      options.getWindows ?? (() => BrowserWindow.getAllWindows());
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer =
      options.clearTimeout ??
      ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.restartDelayMs = options.restartDelayMs ?? 1_000;
    this.maxRestarts = options.maxRestarts ?? 3;
    this.prepareTurn =
      options.prepareTurn ??
      (async () => {
        throw new Error("Pi runtime session preparation is not configured");
      });
    this.workspaceCacheRoot = options.workspaceCacheRoot ?? "";
    this.logger = options.logger ?? console;
    this.state = {
      status: "unavailable",
      pid: null,
      version: null,
      restartCount: 0,
      startedAt: null,
      updatedAt: this.timestamp(),
      lastExitCode: null,
      lastError: null,
    };
  }

  getStatus(): PiSidecarState {
    return {
      ...this.state,
      lastError: this.state.lastError && { ...this.state.lastError },
    };
  }

  start(): PiSidecarState {
    if (this.process) return this.getStatus();
    this.stopping = false;
    this.updateState({ status: "starting" });

    const child = this.fork(this.sidecarPath, [], {
      serviceName: "ThinkWork Pi Sidecar",
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process = child;
    this.attachProcess(child);
    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) {
      this.clearTimer(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.process) {
      this.updateState({ status: "stopped", pid: null });
      return;
    }
    this.updateState({ status: "stopping" });
    this.process.kill();
    this.process = null;
    this.updateState({ status: "stopped", pid: null });
  }

  async startTurn(request: PiStartTurnRequest): Promise<PiStartTurnResponse> {
    if (!this.process || this.state.status !== "healthy") {
      throw new Error("Pi sidecar is not healthy");
    }
    const requestId = randomUUID();
    this.activeTurns.set(requestId, {
      threadId: request.threadId,
      threadTurnId: null,
    });
    this.logger.info("[pi-sidecar] preparing local Pi turn", {
      requestId,
      hasMessageId: Boolean(request.messageId),
      hasUserMessage: request.userMessage.length > 0,
    });
    this.emitDiagnostic({
      level: "info",
      message: formatDiagnosticMessage("preparing local Pi turn", {
        requestId,
        hasMessageId: Boolean(request.messageId),
        hasUserMessage: request.userMessage.length > 0,
      }),
      source: "main",
      requestId,
      threadId: request.threadId,
      threadTurnId: null,
    });
    let session: Awaited<ReturnType<PreparePiRuntimeSession>>;
    try {
      session = await this.prepareTurn(request);
    } catch (error) {
      this.activeTurns.delete(requestId);
      throw error;
    }
    this.activeTurns.set(requestId, {
      threadId: request.threadId,
      threadTurnId: session.threadTurnId,
    });
    this.logger.info("[pi-sidecar] local Pi turn prepared", {
      requestId,
      threadTurnId: session.threadTurnId,
      runtimeHost: session.invocation.runtime_host,
      sdkPackage: session.invocation.pi_sdk.packageName,
    });
    this.emitDiagnostic({
      level: "info",
      message: formatDiagnosticMessage("local Pi turn prepared", {
        requestId,
        threadTurnId: session.threadTurnId,
        runtimeHost: session.invocation.runtime_host,
        sdkPackage: session.invocation.pi_sdk.packageName,
      }),
      source: "main",
      requestId,
      threadId: request.threadId,
      threadTurnId: session.threadTurnId,
    });
    const payload: PiSidecarTurnPayload = {
      session,
      workspaceCacheRoot: this.workspaceCacheRoot,
    };
    this.post({
      type: "start-turn",
      requestId,
      payload,
    });
    this.logger.info("[pi-sidecar] local Pi turn sent to sidecar", {
      requestId,
      threadTurnId: session.threadTurnId,
    });
    this.emitDiagnostic({
      level: "info",
      message: formatDiagnosticMessage("local Pi turn sent to sidecar", {
        requestId,
        threadTurnId: session.threadTurnId,
      }),
      source: "main",
      requestId,
      threadId: request.threadId,
      threadTurnId: session.threadTurnId,
    });
    return { accepted: true, requestId };
  }

  cancelTurn(request: PiCancelTurnRequest): PiCancelTurnResponse {
    if (!this.process) return { cancelled: false };
    this.post({ type: "cancel-turn", requestId: request.requestId });
    return { cancelled: true };
  }

  private attachProcess(child: UtilityProcessLike): void {
    child.on("spawn", () => {
      this.updateState({
        status: "starting",
        pid: child.pid ?? null,
        startedAt: this.timestamp(),
      });
      this.post({ type: "ping" });
    });
    child.on("message", (message) => this.handleMessage(message));
    child.on("error", (type, location) => {
      this.updateState({
        status: "error",
        lastError: {
          code: type,
          message: redactPiDiagnosticLine(`${type} at ${location}`),
        },
      });
    });
    child.on("exit", (code) => this.handleExit(child, code));
    this.pipeDiagnostics(child.stdout, "info");
    this.pipeDiagnostics(child.stderr, "error");
  }

  private handleMessage(message: unknown): void {
    if (!isSidecarChildMessage(message)) return;
    switch (message.type) {
      case "ready":
      case "pong":
        this.updateState({
          status: "healthy",
          version: message.version,
          pid: this.process?.pid ?? this.state.pid,
          lastError: null,
        });
        return;
      case "diagnostic":
        this.writeDiagnosticLine(message.level, message.message, "sidecar");
        return;
      case "turn-accepted":
        this.logger.info("[pi-sidecar] local Pi turn accepted", {
          requestId: message.requestId,
        });
        this.emitDiagnostic({
          level: "info",
          message: formatDiagnosticMessage("local Pi turn accepted", {
            requestId: message.requestId,
          }),
          source: "main",
          requestId: message.requestId,
          ...this.contextForRequest(message.requestId),
        });
        return;
      case "turn-cancelled":
        this.logger.warn("[pi-sidecar] local Pi turn cancelled", {
          requestId: message.requestId,
        });
        this.emitDiagnostic({
          level: "warn",
          message: formatDiagnosticMessage("local Pi turn cancelled", {
            requestId: message.requestId,
          }),
          source: "main",
          requestId: message.requestId,
          ...this.contextForRequest(message.requestId),
        });
        this.activeTurns.delete(message.requestId);
        return;
    }
  }

  private handleExit(child: UtilityProcessLike, code: number): void {
    if (this.process !== child) return;
    this.process = null;
    const canRestart =
      !this.stopping && this.state.restartCount < this.maxRestarts;
    this.updateState({
      status: this.stopping ? "stopped" : canRestart ? "restarting" : "crashed",
      pid: null,
      lastExitCode: code,
      lastError:
        this.stopping || code === 0
          ? null
          : {
              code: "EXIT",
              message: `Pi sidecar exited with code ${code}`,
            },
    });
    if (!canRestart) return;
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = null;
      this.updateState({ restartCount: this.state.restartCount + 1 });
      this.start();
    }, this.restartDelayMs);
  }

  private post(message: PiSidecarParentMessage): void {
    this.process?.postMessage(message);
  }

  private pipeDiagnostics(
    stream: NodeJS.ReadableStream | null,
    level: "info" | "error",
  ): void {
    stream?.on("data", (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        this.writeDiagnosticLine(level, line, "sidecar");
      }
    });
  }

  private writeDiagnosticLine(
    level: "info" | "warn" | "error",
    line: string,
    source: PiDiagnosticEvent["source"],
  ): void {
    const text = redactPiDiagnosticLine(line.trim());
    if (!text) return;
    this.logger[level](`[pi-sidecar] ${text}`);
    const requestId = extractRequestId(text);
    this.emitDiagnostic({
      level,
      message: text,
      source,
      requestId,
      ...this.contextForRequest(requestId),
    });
    if (requestId && /^turn [^\s]+ /.test(text)) {
      this.activeTurns.delete(requestId);
    }
  }

  private emitDiagnostic(event: Omit<PiDiagnosticEvent, "emittedAt">): void {
    const payload: PiDiagnosticEvent = {
      ...event,
      message: redactPiDiagnosticLine(event.message),
      emittedAt: this.timestamp(),
    };
    for (const window of this.getWindows()) {
      window.webContents.send(PI_DIAGNOSTIC_EVENT_CHANNEL, payload);
    }
  }

  private contextForRequest(requestId: string | null): {
    threadId: string | null;
    threadTurnId: string | null;
  } {
    if (!requestId) {
      return { threadId: null, threadTurnId: null };
    }
    return (
      this.activeTurns.get(requestId) ?? {
        threadId: null,
        threadTurnId: null,
      }
    );
  }

  private updateState(patch: Partial<PiSidecarState>): void {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: this.timestamp(),
    };
    for (const window of this.getWindows()) {
      window.webContents.send(PI_STATUS_EVENT_CHANNEL, this.getStatus());
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function formatDiagnosticMessage(
  message: string,
  extra: Record<string, unknown>,
): string {
  return `${message} ${JSON.stringify(extra)}`;
}

function extractRequestId(text: string): string | null {
  const jsonMatch = text.match(/"requestId":"([^"]+)"/);
  if (jsonMatch) return jsonMatch[1];
  const turnMatch = text.match(/\bturn\s+([^\s;]+)\s+/);
  return turnMatch?.[1] ?? null;
}

function isSidecarChildMessage(
  message: unknown,
): message is PiSidecarChildMessage {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  if (type === "ready" || type === "pong") {
    return typeof (message as { version?: unknown }).version === "string";
  }
  if (type === "turn-accepted" || type === "turn-cancelled") {
    return typeof (message as { requestId?: unknown }).requestId === "string";
  }
  if (type !== "diagnostic") return false;
  const diagnostic = message as { level?: unknown; message?: unknown };
  return (
    (diagnostic.level === "info" ||
      diagnostic.level === "warn" ||
      diagnostic.level === "error") &&
    typeof diagnostic.message === "string"
  );
}

export function createPiSidecarController(
  options?: PiSidecarControllerOptions,
): PiSidecarController {
  return new PiSidecarController(options);
}

export { PI_SIDECAR_PROTOCOL_VERSION, redactPiDiagnosticLine };
