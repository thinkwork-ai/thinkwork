import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PI_DIAGNOSTIC_EVENT_CHANNEL } from "@thinkwork/desktop-ipc";
import { describe, expect, it, vi } from "vitest";
import {
  PiSidecarController,
  redactPiDiagnosticLine,
  type UtilityProcessLike,
} from "../../src/main/pi-sidecar-controller";
import {
  isPiSidecarParentMessage,
  resolvePiSidecarEntryPath,
} from "../../src/main/pi-sidecar-session";

class FakeUtilityProcess extends EventEmitter {
  pid?: number = 4321;
  stdout = new PassThrough();
  stderr = new PassThrough();
  messages: unknown[] = [];
  killed = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function createController(processes: FakeUtilityProcess[] = []) {
  const sentStates: unknown[] = [];
  const sentMessages: Array<{ channel: string; payload: unknown }> = [];
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const controller = new PiSidecarController({
    sidecarPath: "/app/out/main/pi-sidecar.js",
    fork: () => {
      const child = new FakeUtilityProcess();
      processes.push(child);
      return child as unknown as UtilityProcessLike;
    },
    getWindows: () =>
      [
        {
          webContents: {
            send: (channel: string, payload: unknown) => {
              sentMessages.push({ channel, payload });
              sentStates.push(payload);
            },
          },
        },
      ] as never,
    now: () => new Date("2026-05-28T12:00:00.000Z"),
    restartDelayMs: 10,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout: vi.fn(),
    workspaceCacheRoot: "/user-data/pi-workspaces",
    prepareTurn: async (request) => ({
      threadTurnId: "turn-1",
      expiresAt: "2026-05-28T13:00:00.000Z",
      finalizeCallbackUrl: "https://api.test/api/threads/thread-1/finalize",
      finalizeCallbackSecret: "dps_secret",
      sidecarCredentials: {},
      invocation: {
        pi_sdk: {
          packageName: "@earendil-works/pi-coding-agent",
          minimumVersion: "0.76.0",
          docsUrl: "https://pi.dev/docs/latest/sdk",
          sessionFactory: "createAgentSession",
          runtimeFactory: "createAgentSessionRuntime",
          sessionManager: "in-memory",
          authStorage: "runtime-overrides",
          resourceLoader: "thinkwork-rendered-workspace",
          modelSource: "prepared-invocation",
          toolSource: "thinkwork-prepared-policy",
        },
        tenant_id: "tenant-1",
        workspace_tenant_id: "tenant-1",
        assistant_id: request.agentId,
        thread_id: request.threadId,
        user_id: "user-1",
        current_user_email: "eric@example.com",
        trace_id: "trace-1",
        message: request.userMessage,
        messages_history: [],
        runtime_type: "pi",
        runtime_host: "desktop-local",
        model: null,
        trigger_channel: "desktop",
        finalize_callback_secret: "dps_secret",
        thread_turn_id: "turn-1",
      },
    }),
    logger,
  });
  return { controller, processes, sentStates, sentMessages, logger };
}

describe("PiSidecarController", () => {
  it("starts the sidecar and reports healthy status", () => {
    const { controller, processes, sentStates } = createController();

    expect(controller.start()).toMatchObject({ status: "starting" });
    const child = processes[0];
    child.emit("spawn");
    child.emit("message", { type: "ready", version: "0.1.0" });

    expect(controller.getStatus()).toMatchObject({
      status: "healthy",
      pid: 4321,
      version: "0.1.0",
    });
    expect(child.messages).toContainEqual({ type: "ping" });
    expect(sentStates).toContainEqual(
      expect.objectContaining({ status: "healthy" }),
    );
  });

  it("posts turn commands only when the sidecar is healthy", async () => {
    const { controller, processes } = createController();

    await expect(
      controller.startTurn({
        agentId: "agent-1",
        threadId: "thread-1",
        userMessage: "hello",
      }),
    ).rejects.toThrow(/not healthy/);

    controller.start();
    const child = processes[0];
    child.emit("spawn");
    child.emit("message", { type: "ready", version: "0.1.0" });

    const response = await controller.startTurn({
      agentId: "agent-1",
      threadId: "thread-1",
      messageId: "message-1",
      userMessage: "Run locally",
    });

    expect(response.accepted).toBe(true);
    expect(child.messages.at(-1)).toMatchObject({
      type: "start-turn",
      requestId: response.requestId,
      payload: {
        workspaceCacheRoot: "/user-data/pi-workspaces",
        session: {
          invocation: {
            assistant_id: "agent-1",
            thread_id: "thread-1",
            message: "Run locally",
            runtime_host: "desktop-local",
          },
        },
      },
    });
  });

  it("restarts with bounded state after a crash", () => {
    const processes: FakeUtilityProcess[] = [];
    const { controller } = createController(processes);

    controller.start();
    processes[0].emit("spawn");
    processes[0].emit("message", { type: "ready", version: "0.1.0" });
    processes[0].emit("exit", 1);

    expect(processes).toHaveLength(2);
    expect(controller.getStatus()).toMatchObject({
      status: "starting",
      restartCount: 1,
      lastExitCode: 1,
      lastError: {
        code: "EXIT",
        message: "Pi sidecar exited with code 1",
      },
    });
  });

  it("kills the utility process during shutdown", async () => {
    const { controller, processes } = createController();

    controller.start();
    const child = processes[0];
    await controller.stop();

    expect(child.killed).toBe(true);
    expect(controller.getStatus()).toMatchObject({
      status: "stopped",
      pid: null,
    });
  });

  it("redacts sensitive diagnostic lines", () => {
    expect(
      redactPiDiagnosticLine(
        'authorization=Bearer abc.def secretAccessKey=top AKIAABCDEFGHIJKLMNOP {"message":"summarize private customer data"} https://s3.test/key?X-Amz-Signature=sig',
      ),
    ).toBe(
      'authorization=[redacted] secretAccessKey=[redacted] [redacted-aws-key] {"message":"[redacted-message]"} https://s3.test/key?X-Amz-Signature=[redacted]',
    );
  });

  it("streams sidecar diagnostics to renderer windows with turn context", async () => {
    const { controller, processes, sentMessages } = createController();

    controller.start();
    const child = processes[0];
    child.emit("spawn");
    child.emit("message", { type: "ready", version: "0.1.0" });

    const response = await controller.startTurn({
      agentId: "agent-1",
      threadId: "thread-1",
      messageId: "message-1",
      userMessage: "Run locally",
    });
    child.stdout.write(
      `[pi-sidecar] local Pi sidecar received turn {"requestId":"${response.requestId}","threadTurnId":"turn-1","secret":"hide-me"}\n`,
    );

    const diagnostics = sentMessages.filter(
      (message) => message.channel === PI_DIAGNOSTIC_EVENT_CHANNEL,
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          level: "info",
          source: "sidecar",
          requestId: response.requestId,
          threadId: "thread-1",
          threadTurnId: "turn-1",
          message: expect.stringContaining("local Pi sidecar received turn"),
        }),
      }),
    );
    expect(JSON.stringify(diagnostics)).toContain("[redacted]");
    expect(JSON.stringify(diagnostics)).not.toContain("hide-me");
  });

  it("resolves the sidecar entry when imported from a code-split chunk", () => {
    expect(resolvePiSidecarEntryPath("/app/out/main/chunks")).toBe(
      "/app/out/main/pi-sidecar.js",
    );
  });

  it("rejects malformed sidecar parent messages", () => {
    expect(isPiSidecarParentMessage(null)).toBe(false);
    expect(isPiSidecarParentMessage({ type: "start-turn" })).toBe(false);
    expect(
      isPiSidecarParentMessage({ type: "start-turn", requestId: "request-1" }),
    ).toBe(false);
    expect(
      isPiSidecarParentMessage({
        type: "start-turn",
        requestId: "request-1",
        payload: {
          workspaceCacheRoot: "/tmp/pi",
          session: { invocation: { runtime_host: "desktop-local" } },
        },
      }),
    ).toBe(true);
  });
});
