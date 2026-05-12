import { describe, expect, it, vi } from "vitest";
import { executeRunbook, type RunbookExecutionContext } from "./runbooks.js";
import { invokeRunbookAgentCoreStep } from "./agentcore-runbook-step.js";

vi.mock("./agentcore-runbook-step.js", () => ({
  invokeRunbookAgentCoreStep: vi.fn(async () => ({
    ok: true,
    responseText: "Direct AgentCore step complete",
    model: "model-1",
  })),
}));

function context(
  overrides: Partial<RunbookExecutionContext> = {},
): RunbookExecutionContext {
  return {
    taskId: "task-1",
    run: {
      id: "run-1",
      status: "queued",
      runbookSlug: "research-dashboard",
      runbookVersion: "0.1.0",
    },
    tasks: [
      {
        id: "rt-1",
        phaseId: "discover",
        phaseTitle: "Discover",
        taskKey: "discover:1",
        title: "Discover evidence",
        status: "pending",
        dependsOn: [],
        capabilityRoles: ["research"],
        sortOrder: 1,
      },
      {
        id: "rt-2",
        phaseId: "produce",
        phaseTitle: "Produce",
        taskKey: "produce:1",
        title: "Produce dashboard",
        status: "pending",
        dependsOn: ["discover:1"],
        capabilityRoles: ["artifact_build"],
        sortOrder: 2,
      },
    ],
    previousOutputs: {},
    ...overrides,
  };
}

function apiWithContext(initial: RunbookExecutionContext) {
  let current = initial;
  const api = {
    appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
    loadRunbookExecutionContext: vi
      .fn()
      .mockImplementation(async () => current),
    startRunbookTask: vi
      .fn()
      .mockImplementation(async (_taskId, runbookTaskId) => {
        current = {
          ...current,
          run: { ...current.run, status: "running" },
          tasks: current.tasks.map((task) =>
            task.id === runbookTaskId ? { ...task, status: "running" } : task,
          ),
        };
        return { ok: true };
      }),
    completeRunbookTask: vi
      .fn()
      .mockImplementation(async (_taskId, runbookTaskId, output) => {
        current = {
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === runbookTaskId
              ? { ...task, status: "completed", output }
              : task,
          ),
        };
        return { ok: true };
      }),
    failRunbookTask: vi.fn().mockResolvedValue({ ok: true }),
    completeRunbookRun: vi.fn().mockResolvedValue({ ok: true }),
    executeRunbookTask: vi.fn().mockResolvedValue({
      ok: true,
      responseText: "Step completed",
    }),
    recordRunbookResponse: vi.fn().mockResolvedValue({ ok: true }),
  };
  return api;
}

describe("executeRunbook", () => {
  it("runs tasks sequentially and passes prior outputs forward", async () => {
    const api = apiWithContext(context());
    const runner = vi.fn().mockImplementation(async (task, runContext) => ({
      taskKey: task.taskKey,
      priorOutputKeys: Object.keys(runContext.previousOutputs),
    }));

    const result = await executeRunbook(
      {
        id: "task-1",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      },
      api,
      runner,
    );

    expect(api.startRunbookTask).toHaveBeenNthCalledWith(1, "task-1", "rt-1");
    expect(api.startRunbookTask).toHaveBeenNthCalledWith(2, "task-1", "rt-2");
    expect(runner.mock.calls[1][1].previousOutputs).toHaveProperty(
      "discover:1",
    );
    expect(api.completeRunbookRun).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        runbookRunId: "run-1",
        completedTaskCount: 2,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      taskType: "runbook_execute",
      status: "completed",
      runbookRunId: "run-1",
    });
  });

  it("uses the runtime API as the default per-task runner", async () => {
    const api = apiWithContext(context());
    api.executeRunbookTask
      .mockResolvedValueOnce({
        ok: true,
        responseText: "Discovery complete",
        model: "model-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        responseText: "Dashboard saved",
        model: "model-1",
      });

    await executeRunbook(
      {
        id: "task-1",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      },
      api,
    );

    expect(api.executeRunbookTask).toHaveBeenNthCalledWith(1, "task-1", "rt-1");
    expect(api.executeRunbookTask).toHaveBeenNthCalledWith(2, "task-1", "rt-2");
    expect(api.recordRunbookResponse).toHaveBeenCalledWith("task-1", {
      content: "Dashboard saved",
      model: "model-1",
      usage: undefined,
    });
  });

  it("waits for asynchronously dispatched runbook steps to persist completion", async () => {
    const api = apiWithContext(context());
    api.executeRunbookTask.mockImplementation(
      async (_taskId, runbookTaskId) => {
        const output =
          runbookTaskId === "rt-1"
            ? { ok: true, responseText: "Discovery complete", model: "model-1" }
            : { ok: true, responseText: "Dashboard saved", model: "model-1" };
        await api.completeRunbookTask("task-1", runbookTaskId, output);
        return {
          ok: true,
          dispatched: true,
          runbookTaskId,
          status: "running",
        };
      },
    );

    await executeRunbook(
      {
        id: "task-1",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      },
      api,
    );

    expect(api.executeRunbookTask).toHaveBeenNthCalledWith(1, "task-1", "rt-1");
    expect(api.executeRunbookTask).toHaveBeenNthCalledWith(2, "task-1", "rt-2");
    expect(api.completeRunbookTask).toHaveBeenCalledTimes(2);
    expect(api.recordRunbookResponse).toHaveBeenCalledWith("task-1", {
      content: "Dashboard saved",
      model: "model-1",
      usage: undefined,
    });
  });

  it("invokes AgentCore directly when the runtime API returns an invocation plan", async () => {
    const api = apiWithContext(context());
    api.executeRunbookTask
      .mockResolvedValueOnce({
        ok: true,
        invocation: {
          provider: "bedrock-agentcore",
          runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc",
          runtimeSessionId: "session-1",
          payload: { message: "discover" },
        },
        runbookTaskId: "rt-1",
        status: "running",
      })
      .mockResolvedValueOnce({
        ok: true,
        responseText: "Dashboard saved",
        model: "model-1",
      });

    await executeRunbook(
      {
        id: "task-1",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      },
      api,
    );

    expect(invokeRunbookAgentCoreStep).toHaveBeenCalledWith({
      provider: "bedrock-agentcore",
      runtimeArn: "arn:aws:bedrock-agentcore:us-east-1:123:runtime/abc",
      runtimeSessionId: "session-1",
      payload: { message: "discover" },
    });
    expect(api.completeRunbookTask).toHaveBeenNthCalledWith(
      1,
      "task-1",
      "rt-1",
      expect.objectContaining({
        responseText: "Direct AgentCore step complete",
      }),
    );
  });

  it("fails the current task and run when a task runner throws", async () => {
    const api = apiWithContext(context());
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("model failed"));

    await expect(
      executeRunbook(
        {
          id: "task-1",
          taskType: "runbook_execute",
          input: { runbookRunId: "run-1" },
        },
        api,
        runner,
      ),
    ).rejects.toThrow("model failed");

    expect(api.failRunbookTask).toHaveBeenCalledWith("task-1", "rt-2", {
      message: "model failed",
    });
    expect(api.completeRunbookRun).not.toHaveBeenCalled();
  });

  it("returns a cancelled result when the run is cancelled between tasks", async () => {
    const api = apiWithContext(
      context({
        run: {
          id: "run-1",
          status: "cancelled",
          runbookSlug: "research-dashboard",
          runbookVersion: "0.1.0",
        },
      }),
    );

    const result = await executeRunbook(
      {
        id: "task-1",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      },
      api,
      vi.fn(),
    );

    expect(api.startRunbookTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      taskType: "runbook_execute",
      status: "cancelled",
      cancelled: true,
    });
  });
});
