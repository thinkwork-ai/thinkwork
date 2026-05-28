import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  PiSidecarController,
  redactPiDiagnosticLine,
  type UtilityProcessLike,
} from "../../src/main/pi-sidecar-controller";
import { isPiSidecarParentMessage } from "../../src/main/pi-sidecar-session";

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
            send: (_channel: string, payload: unknown) => {
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
    logger,
  });
  return { controller, processes, sentStates, logger };
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

  it("posts turn commands only when the sidecar is healthy", () => {
    const { controller, processes } = createController();

    expect(() =>
      controller.startTurn({
        agentId: "agent-1",
        threadId: "thread-1",
        userMessage: "hello",
      }),
    ).toThrow(/not healthy/);

    controller.start();
    const child = processes[0];
    child.emit("spawn");
    child.emit("message", { type: "ready", version: "0.1.0" });

    const response = controller.startTurn({
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
        agentId: "agent-1",
        threadId: "thread-1",
        userMessage: "Run locally",
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
        "authorization=Bearer abc.def secretAccessKey=top AKIAABCDEFGHIJKLMNOP",
      ),
    ).toBe(
      "authorization=[redacted] secretAccessKey=[redacted] [redacted-aws-key]",
    );
  });

  it("rejects malformed sidecar parent messages", () => {
    expect(isPiSidecarParentMessage(null)).toBe(false);
    expect(isPiSidecarParentMessage({ type: "start-turn" })).toBe(false);
    expect(
      isPiSidecarParentMessage({ type: "start-turn", requestId: "request-1" }),
    ).toBe(true);
  });
});
