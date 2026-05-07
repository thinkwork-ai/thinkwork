import { describe, expect, it, vi } from "vitest";
import { handleTask } from "./task-loop.js";

describe("Computer task loop", () => {
  it("checks Google Workspace connection status through the runtime API", async () => {
    const api = {
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
      checkGoogleWorkspaceConnection: vi.fn().mockResolvedValue({
        providerName: "google_productivity",
        connected: true,
        tokenResolved: true,
        connectionId: "connection-1",
        checkedAt: "2026-05-07T00:00:00.000Z",
      }),
    };

    const output = await handleTask(
      {
        id: "task-1",
        taskType: "google_workspace_auth_check",
      },
      "/workspace",
      api,
    );

    expect(api.checkGoogleWorkspaceConnection).toHaveBeenCalledOnce();
    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-1", {
      eventType: "google_workspace_auth_checked",
      level: "info",
      payload: {
        providerName: "google_productivity",
        connected: true,
        tokenResolved: true,
        connectionId: "connection-1",
        reason: null,
      },
    });
    expect(output).toMatchObject({
      ok: true,
      taskType: "google_workspace_auth_check",
      googleWorkspace: {
        connected: true,
        tokenResolved: true,
      },
    });
  });
});
