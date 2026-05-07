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
      checkGoogleWorkspaceConnection: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
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
      checkGoogleWorkspaceConnection: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
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

  it("writes workspace files under the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const output = await handleTask(
      {
        id: "task-4",
        taskType: "workspace_file_write",
        input: { path: "notes/phase3.txt", content: "hello computer\n" },
      },
      root,
    );

    expect(output).toMatchObject({
      ok: true,
      taskType: "workspace_file_write",
      relativePath: "notes/phase3.txt",
      bytes: 15,
    });
    await expect(
      readFile(join(root, "notes/phase3.txt"), "utf8"),
    ).resolves.toBe("hello computer\n");
  });

  it("fails unsafe workspace file paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));

    await expect(
      handleTask(
        {
          id: "task-5",
          taskType: "workspace_file_write",
          input: { path: "../escape.txt", content: "nope" },
        },
        root,
      ),
    ).rejects.toThrow("Workspace path cannot contain");
  });

  it("returns a structured Google CLI smoke result", async () => {
    const output = await handleTask(
      { id: "task-6", taskType: "google_cli_smoke" },
      "/tmp",
    );

    expect(output).toMatchObject({
      ok: true,
      taskType: "google_cli_smoke",
      smoke: expect.objectContaining({
        available: expect.any(Boolean),
        binary: expect.any(String),
      }),
    });
  });

  it("accepts connector work as a handoff-only task", async () => {
    const output = await handleTask(
      {
        id: "task-7",
        taskType: "connector_work",
        input: {
          connectorId: "connector-1",
          connectorExecutionId: "execution-1",
          externalRef: "TECH-59",
          title: "Handle Linear issue",
          body: "Linear issue body should stay in the existing thread",
        },
      },
      "/tmp",
    );

    expect(output).toEqual({
      ok: true,
      taskType: "connector_work",
      accepted: true,
      mode: "handoff_only",
    });
  });

  it("completes connector work tasks without failing the runtime handoff", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue({
        id: "task-8",
        taskType: "connector_work",
        input: {
          connectorId: "connector-1",
          connectorExecutionId: "execution-1",
          externalRef: "TECH-59",
          title: "Handle Linear issue",
          body: "Linear issue body should stay in the existing thread",
        },
      }),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      appendTaskEvent: vi.fn(),
      checkGoogleWorkspaceConnection: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
    };

    const result = await runTaskLoopOnce({
      api,
      workspaceRoot: "/tmp",
      idleDelayMs: 0,
    });

    expect(result).toMatchObject({ handled: true, taskId: "task-8" });
    expect(api.completeTask).toHaveBeenCalledWith("task-8", {
      ok: true,
      taskType: "connector_work",
      accepted: true,
      mode: "handoff_only",
    });
    expect(api.failTask).not.toHaveBeenCalled();
    expect(api.appendTaskEvent).not.toHaveBeenCalled();
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
      checkGoogleWorkspaceConnection: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
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
