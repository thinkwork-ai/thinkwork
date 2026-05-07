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
      delegateConnectorWork: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
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
      delegateConnectorWork: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
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

  it("delegates connector work through the Computer runtime API", async () => {
    const api = {
      appendTaskEvent: vi.fn(),
      checkGoogleWorkspaceConnection: vi.fn(),
      delegateConnectorWork: vi.fn().mockResolvedValue({
        delegated: true,
        idempotent: false,
        mode: "managed_agent",
        delegationId: "delegation-1",
        agentId: "agent-1",
        threadId: "thread-1",
        messageId: "message-1",
        status: "running",
      }),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
    };
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
      api,
    );

    expect(output).toEqual({
      ok: true,
      taskType: "connector_work",
      accepted: true,
      delegated: true,
      idempotent: false,
      mode: "managed_agent",
      delegationId: "delegation-1",
      agentId: "agent-1",
      threadId: "thread-1",
      messageId: "message-1",
      status: "running",
    });
    expect(api.delegateConnectorWork).toHaveBeenCalledWith("task-7");
  });

  it("completes connector work tasks after delegation is accepted", async () => {
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
      delegateConnectorWork: vi.fn().mockResolvedValue({
        delegated: true,
        idempotent: false,
        mode: "managed_agent",
        delegationId: "delegation-1",
        agentId: "agent-1",
        threadId: "thread-1",
        messageId: "message-1",
        status: "running",
      }),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
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
      delegated: true,
      idempotent: false,
      mode: "managed_agent",
      delegationId: "delegation-1",
      agentId: "agent-1",
      threadId: "thread-1",
      messageId: "message-1",
      status: "running",
    });
    expect(api.failTask).not.toHaveBeenCalled();
    expect(api.appendTaskEvent).not.toHaveBeenCalled();
  });

  it("executes Computer thread turns before completing the task", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue({
        id: "task-10",
        taskType: "thread_turn",
        input: {
          threadId: "thread-1",
          messageId: "message-1",
          source: "chat_message",
        },
      }),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      appendTaskEvent: vi.fn(),
      checkGoogleWorkspaceConnection: vi.fn(),
      delegateConnectorWork: vi.fn(),
      loadThreadTurnContext: vi.fn().mockResolvedValue({
        taskId: "task-10",
        source: "chat_message",
        computer: {
          id: "computer-1",
          name: "Marco",
          slug: "marco",
          workspaceRoot: "/workspace",
        },
        thread: { id: "thread-1", title: "Hello Marco" },
        message: { id: "message-1", content: "Hello" },
        messagesHistory: [{ id: "message-1", role: "user", content: "Hello" }],
        model: "model-1",
        systemPrompt: "You are Marco.",
      }),
      recordThreadTurnResponse: vi.fn().mockResolvedValue({
        responded: true,
        mode: "computer_native",
        responseMessageId: "message-2",
        threadId: "thread-1",
        messageId: "message-1",
        status: "completed",
        model: "model-1",
      }),
      resolveGoogleWorkspaceCliToken: vi.fn(),
    };
    const computerChat = vi.fn().mockResolvedValue({
      content: "Hi from Marco",
      model: "model-1",
    });

    const result = await runTaskLoopOnce({
      api,
      workspaceRoot: "/tmp",
      idleDelayMs: 0,
      computerChat,
    });

    expect(result).toMatchObject({ handled: true, taskId: "task-10" });
    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-10", {
      eventType: "thread_turn_claimed",
      level: "info",
      payload: {
        threadId: "thread-1",
        messageId: "message-1",
        source: "chat_message",
      },
    });
    expect(api.loadThreadTurnContext).toHaveBeenCalledWith("task-10");
    expect(computerChat).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-10" }),
      { workspaceRoot: "/tmp" },
    );
    expect(api.recordThreadTurnResponse).toHaveBeenCalledWith("task-10", {
      content: "Hi from Marco",
      model: "model-1",
    });
    expect(api.completeTask).toHaveBeenCalledWith("task-10", {
      ok: true,
      taskType: "thread_turn",
      responded: true,
      mode: "computer_native",
      responseMessageId: "message-2",
      threadId: "thread-1",
      messageId: "message-1",
      status: "completed",
      model: "model-1",
    });
    expect(api.failTask).not.toHaveBeenCalled();
  });

  it("fails connector work tasks when delegation fails", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue({
        id: "task-9",
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
      delegateConnectorWork: vi
        .fn()
        .mockRejectedValue(new Error("delegation unavailable")),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
    };

    const result = await runTaskLoopOnce({
      api,
      workspaceRoot: "/tmp",
      idleDelayMs: 0,
    });

    expect(result).toMatchObject({
      handled: true,
      taskId: "task-9",
      error: { message: "delegation unavailable" },
    });
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-9", {
      eventType: "task_error",
      level: "error",
      payload: { message: "delegation unavailable" },
    });
    expect(api.failTask).toHaveBeenCalledWith("task-9", {
      message: "delegation unavailable",
    });
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
      delegateConnectorWork: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
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
