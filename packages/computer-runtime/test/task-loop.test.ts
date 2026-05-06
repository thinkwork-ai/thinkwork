import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { handleTask, runTaskLoopOnce } from "../src/task-loop.js";

describe("Computer runtime task loop", () => {
  it("completes noop tasks with a structured result", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue({ id: "task-1", taskType: "noop" }),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      appendTaskEvent: vi.fn(),
    };

    const result = await runTaskLoopOnce({
      api,
      workspaceRoot: "/tmp",
      idleDelayMs: 0,
    });

    expect(result).toMatchObject({ handled: true, taskId: "task-1" });
    expect(api.completeTask).toHaveBeenCalledWith("task-1", {
      ok: true,
      taskType: "noop",
    });
  });

  it("backs off when no task is available", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue(null),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      appendTaskEvent: vi.fn(),
    };

    await expect(
      runTaskLoopOnce({ api, workspaceRoot: "/tmp", idleDelayMs: 0 }),
    ).resolves.toEqual({ handled: false });
  });

  it("writes health-check markers to the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const output = await handleTask(
      { id: "task-2", taskType: "health_check" },
      root,
    );
    expect(output).toMatchObject({ ok: true, taskType: "health_check" });
    const markerPath = output.markerPath;
    expect(typeof markerPath).toBe("string");
    if (typeof markerPath !== "string") throw new Error("markerPath missing");
    await expect(readFile(markerPath, "utf8")).resolves.toContain("task-2");
  });

  it("fails unsupported task types without leaking input bodies", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue({
        id: "task-3",
        taskType: "unknown",
        input: { secret: "do-not-log" },
      }),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      appendTaskEvent: vi.fn(),
    };

    const result = await runTaskLoopOnce({
      api,
      workspaceRoot: "/tmp",
      idleDelayMs: 0,
    });

    expect(result).toMatchObject({ handled: true, taskId: "task-3" });
    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-3", {
      eventType: "task_error",
      level: "error",
      payload: {
        message: "Unsupported Computer task type: unknown",
      },
    });
    expect(JSON.stringify(api.failTask.mock.calls)).not.toContain("do-not-log");
  });
});
