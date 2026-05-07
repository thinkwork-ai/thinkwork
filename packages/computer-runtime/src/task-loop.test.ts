import { describe, expect, it, vi } from "vitest";
import { handleTask } from "./task-loop.js";
import { listGoogleCalendarUpcomingWithGws } from "./google-workspace-cli.js";

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

  it("lists upcoming Google Calendar events through the runtime API", async () => {
    const api = {
      appendTaskEvent: vi.fn().mockResolvedValue({ id: "event-2" }),
      checkGoogleWorkspaceConnection: vi.fn(),
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
      [
        "calendar",
        "events",
        "list",
        "--params",
        JSON.stringify({
          calendarId: "primary",
          timeMin: "2026-05-07T10:00:00.000Z",
          timeMax: "2026-05-08T10:00:00.000Z",
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 10,
        }),
      ],
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
    const execFileAsync = vi.fn().mockRejectedValue(
      new Error(
        "Command failed: gws calendar events list\nerror[api]: Request had insufficient authentication scopes.\n",
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
});
