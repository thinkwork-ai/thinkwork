import { describe, expect, it, vi } from "vitest";
import { handleTask, runTaskLoopOnce } from "./task-loop.js";
import { listGoogleCalendarUpcomingWithGws } from "./google-workspace-cli.js";

describe("Computer task loop", () => {
  it("claims and records Computer-owned thread turns", async () => {
    const api = {
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-thread" }),
      checkGoogleWorkspaceConnection: vi.fn(),
      loadThreadTurnContext: vi.fn().mockResolvedValue({
        taskId: "task-thread",
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
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });

    const output = await handleTask(
      {
        id: "task-thread",
        taskType: "thread_turn",
        input: {
          threadId: "thread-1",
          messageId: "message-1",
          source: "chat_message",
        },
      },
      "/workspace",
      api,
      undefined,
      computerChat,
    );

    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-thread", {
      eventType: "thread_turn_claimed",
      level: "info",
      payload: {
        threadId: "thread-1",
        messageId: "message-1",
        source: "chat_message",
      },
    });
    expect(api.loadThreadTurnContext).toHaveBeenCalledWith("task-thread");
    expect(computerChat).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-thread" }),
      { workspaceRoot: "/workspace" },
    );
    expect(api.recordThreadTurnResponse).toHaveBeenCalledWith("task-thread", {
      content: "Hi from Marco",
      model: "model-1",
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
    expect(output).toEqual({
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
  });

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
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
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
        missingScopes: [],
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

  it("executes runbook tasks through the runbook runtime API", async () => {
    const api = {
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-runbook" }),
      checkGoogleWorkspaceConnection: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
      loadRunbookExecutionContext: vi.fn().mockResolvedValue({
        taskId: "task-runbook",
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
        ],
        previousOutputs: {},
      }),
      startRunbookTask: vi.fn().mockResolvedValue({ ok: true }),
      executeRunbookTask: vi.fn().mockResolvedValue({
        ok: true,
        responseText: "Step completed",
      }),
      completeRunbookTask: vi.fn().mockResolvedValue({ ok: true }),
      failRunbookTask: vi.fn().mockResolvedValue({ ok: true }),
      completeRunbookRun: vi.fn().mockResolvedValue({ ok: true }),
      recordRunbookResponse: vi.fn().mockResolvedValue({ ok: true }),
    };
    const runbookTaskRunner = vi.fn().mockResolvedValue({ done: true });

    const output = await handleTask(
      {
        id: "task-runbook",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      },
      "/workspace",
      api,
      undefined,
      undefined,
      runbookTaskRunner,
    );

    expect(api.startRunbookTask).toHaveBeenCalledWith("task-runbook", "rt-1");
    expect(runbookTaskRunner).toHaveBeenCalledWith(
      expect.objectContaining({ taskKey: "discover:1" }),
      expect.objectContaining({
        run: expect.objectContaining({ id: "run-1" }),
      }),
    );
    expect(api.completeRunbookRun).toHaveBeenCalledWith(
      "task-runbook",
      expect.objectContaining({ runbookRunId: "run-1" }),
    );
    expect(output).toMatchObject({
      ok: true,
      taskType: "runbook_execute",
      runbookRunId: "run-1",
      status: "completed",
    });
  });

  it("marks the coarse Computer task cancelled when runbook execution is cancelled", async () => {
    const api = {
      claimTask: vi.fn().mockResolvedValue({
        id: "task-runbook",
        taskType: "runbook_execute",
        input: { runbookRunId: "run-1" },
      }),
      cancelTask: vi.fn().mockResolvedValue({ id: "task-runbook" }),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-runbook" }),
      checkGoogleWorkspaceConnection: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn(),
      loadRunbookExecutionContext: vi.fn().mockResolvedValue({
        taskId: "task-runbook",
        run: {
          id: "run-1",
          status: "cancelled",
          runbookSlug: "research-dashboard",
          runbookVersion: "0.1.0",
        },
        tasks: [],
        previousOutputs: {},
      }),
      startRunbookTask: vi.fn(),
      executeRunbookTask: vi.fn(),
      completeRunbookTask: vi.fn(),
      failRunbookTask: vi.fn(),
      completeRunbookRun: vi.fn(),
      recordRunbookResponse: vi.fn(),
    };

    const result = await runTaskLoopOnce({
      api,
      workspaceRoot: "/workspace",
      idleDelayMs: 0,
    });

    expect(api.cancelTask).toHaveBeenCalledWith(
      "task-runbook",
      expect.objectContaining({ cancelled: true }),
    );
    expect(api.completeTask).not.toHaveBeenCalled();
    expect(result).toMatchObject({ handled: true, taskId: "task-runbook" });
  });

  it("lists upcoming Google Calendar events through the runtime API", async () => {
    const api = {
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-2" }),
      checkGoogleWorkspaceConnection: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn().mockResolvedValue({
        providerName: "google_productivity",
        connected: true,
        tokenResolved: true,
        accessToken: "ya29.secret-token",
      }),
    };
    const gws = vi.fn().mockResolvedValue({
      providerName: "google_productivity",
      connected: true,
      tokenResolved: true,
      calendarAvailable: true,
      eventCount: 2,
      events: [
        { id: "event-1", summary: "Planning" },
        { id: "event-2", summary: "Review" },
      ],
      timeMin: "2026-05-07T10:00:00.000Z",
      timeMax: "2026-05-08T10:00:00.000Z",
      maxResults: 10,
    });

    const output = await handleTask(
      {
        id: "task-2",
        taskType: "google_calendar_upcoming",
        input: {
          timeMin: "2026-05-07T10:00:00.000Z",
          timeMax: "2026-05-08T10:00:00.000Z",
          maxResults: 10,
        },
      },
      "/workspace",
      api,
      gws,
    );

    expect(api.resolveGoogleWorkspaceCliToken).toHaveBeenCalledOnce();
    expect(gws).toHaveBeenCalledWith(
      {
        timeMin: "2026-05-07T10:00:00.000Z",
        timeMax: "2026-05-08T10:00:00.000Z",
        maxResults: 10,
      },
      { accessToken: "ya29.secret-token" },
    );
    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-2", {
      eventType: "google_calendar_upcoming_checked",
      level: "info",
      payload: {
        providerName: "google_productivity",
        connected: true,
        tokenResolved: true,
        calendarAvailable: true,
        eventCount: 2,
        reason: null,
        missingScopes: [],
      },
    });
    expect(JSON.stringify(output)).not.toContain("ya29");
    expect(output).toMatchObject({
      ok: true,
      taskType: "google_calendar_upcoming",
      googleCalendar: {
        calendarAvailable: true,
        eventCount: 2,
      },
    });
  });

  it("reports missing Calendar scope without invoking gws", async () => {
    const api = {
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-3" }),
      checkGoogleWorkspaceConnection: vi.fn(),
      loadThreadTurnContext: vi.fn(),
      recordThreadTurnResponse: vi.fn(),
      resolveGoogleWorkspaceCliToken: vi.fn().mockResolvedValue({
        providerName: "google_productivity",
        connected: true,
        tokenResolved: true,
        accessToken: "ya29.secret-token",
        missingScopes: ["https://www.googleapis.com/auth/calendar"],
      }),
    };
    const gws = vi.fn();

    const output = await handleTask(
      {
        id: "task-3",
        taskType: "google_calendar_upcoming",
        input: {
          timeMin: "2026-05-07T10:00:00.000Z",
          timeMax: "2026-05-08T10:00:00.000Z",
          maxResults: 10,
        },
      },
      "/workspace",
      api,
      gws,
    );

    expect(gws).not.toHaveBeenCalled();
    expect(api.appendTaskEvent).toHaveBeenCalledWith("task-3", {
      eventType: "google_calendar_upcoming_checked",
      level: "warn",
      payload: {
        providerName: "google_productivity",
        connected: true,
        tokenResolved: true,
        calendarAvailable: false,
        eventCount: 0,
        reason: "missing_google_calendar_scope",
        missingScopes: ["https://www.googleapis.com/auth/calendar"],
      },
    });
    expect(JSON.stringify(output)).not.toContain("ya29");
    expect(output).toMatchObject({
      googleCalendar: {
        calendarAvailable: false,
        reason: "missing_google_calendar_scope",
      },
    });
  });

  it("executes gws with an ephemeral token and sanitizes Calendar output", async () => {
    const execFileAsync = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        items: [
          {
            id: "event-1",
            summary: "Planning",
            description: "private notes",
            start: { dateTime: "2026-05-07T10:00:00.000Z" },
            end: { dateTime: "2026-05-07T10:30:00.000Z" },
            attendees: [{ email: "a@example.com" }],
          },
        ],
      }),
      stderr: "",
    });

    const result = await listGoogleCalendarUpcomingWithGws(
      {
        timeMin: "2026-05-07T10:00:00.000Z",
        timeMax: "2026-05-08T10:00:00.000Z",
        maxResults: 10,
      },
      {
        accessToken: "ya29.secret-token",
        binary: "gws",
        execFileAsync,
      },
    );

    expect(execFileAsync).toHaveBeenCalledWith(
      "gws",
      ["calendar", "+agenda", "--days", "1", "--format", "json"],
      expect.objectContaining({
        env: expect.objectContaining({
          GOOGLE_WORKSPACE_CLI_TOKEN: "ya29.secret-token",
        }),
      }),
    );
    expect(result).toMatchObject({
      calendarAvailable: true,
      eventCount: 1,
      events: [{ id: "event-1", summary: "Planning", attendeeCount: 1 }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ya29");
    expect(serialized).not.toContain("private notes");
    expect(serialized).not.toContain("a@example.com");
  });

  it("redacts arbitrary access tokens from gws errors", async () => {
    const execFileAsync = vi
      .fn()
      .mockRejectedValue(new Error("failed with token opaque-secret-token"));

    const result = await listGoogleCalendarUpcomingWithGws(
      {
        timeMin: "2026-05-07T10:00:00.000Z",
        timeMax: "2026-05-08T10:00:00.000Z",
        maxResults: 10,
      },
      {
        accessToken: "opaque-secret-token",
        binary: "gws",
        execFileAsync,
      },
    );

    expect(result).toMatchObject({
      calendarAvailable: false,
      reason: "gws_command_failed",
      message: "failed with token [redacted-token]",
    });
    expect(JSON.stringify(result)).not.toContain("opaque-secret-token");
  });

  it("classifies Google insufficient-scope errors", async () => {
    const execFileAsync = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Command failed: gws calendar +agenda\nerror[api]: Request had insufficient authentication scopes.\n",
        ),
      );

    const result = await listGoogleCalendarUpcomingWithGws(
      {
        timeMin: "2026-05-07T10:00:00.000Z",
        timeMax: "2026-05-08T10:00:00.000Z",
        maxResults: 10,
      },
      {
        accessToken: "ya29.secret-token",
        binary: "gws",
        execFileAsync,
      },
    );

    expect(result).toMatchObject({
      calendarAvailable: false,
      reason: "missing_google_calendar_scope",
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("classifies disabled Google Calendar API errors with the project link", async () => {
    const execFileAsync = vi
      .fn()
      .mockRejectedValue(
        new Error(
          [
            "Command failed: gws calendar +agenda",
            "error[api]: hint: API not enabled for your GCP project.",
            "      Enable it at: https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=430475771862",
          ].join("\n"),
        ),
      );

    const result = await listGoogleCalendarUpcomingWithGws(
      {
        timeMin: "2026-05-07T10:00:00.000Z",
        timeMax: "2026-05-08T10:00:00.000Z",
        maxResults: 10,
      },
      {
        accessToken: "ya29.secret-token",
        binary: "gws",
        execFileAsync,
      },
    );

    expect(result).toMatchObject({
      calendarAvailable: false,
      reason: "google_calendar_api_disabled",
      projectId: "430475771862",
      enableUrl:
        "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=430475771862",
      missingScopes: [],
    });
    expect(JSON.stringify(result)).not.toContain("ya29");
  });
});
