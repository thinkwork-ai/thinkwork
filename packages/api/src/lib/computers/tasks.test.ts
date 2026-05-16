import { describe, expect, it } from "vitest";
import {
  normalizeTaskInput,
  parseComputerTaskStatus,
  parseComputerTaskType,
  validateWorkspaceRelativePath,
} from "./tasks.js";

describe("Computer task helpers", () => {
  it("parses supported task types", () => {
    expect(parseComputerTaskType("HEALTH_CHECK")).toBe("health_check");
    expect(parseComputerTaskType("workspace_file_write")).toBe(
      "workspace_file_write",
    );
    expect(parseComputerTaskType("WORKSPACE_FILE_LIST")).toBe(
      "workspace_file_list",
    );
    expect(parseComputerTaskType("WORKSPACE_FILE_READ")).toBe(
      "workspace_file_read",
    );
    expect(parseComputerTaskType("WORKSPACE_FILE_DELETE")).toBe(
      "workspace_file_delete",
    );
    expect(parseComputerTaskType("THREAD_TURN")).toBe("thread_turn");
    expect(parseComputerTaskType("GOOGLE_CLI_SMOKE")).toBe("google_cli_smoke");
    expect(parseComputerTaskType("GOOGLE_WORKSPACE_AUTH_CHECK")).toBe(
      "google_workspace_auth_check",
    );
    expect(parseComputerTaskType("GOOGLE_CALENDAR_UPCOMING")).toBe(
      "google_calendar_upcoming",
    );
    expect(parseComputerTaskType("RUNBOOK_EXECUTE")).toBe("runbook_execute");
  });

  it("rejects unsupported task types", () => {
    expect(() => parseComputerTaskType("browser_session")).toThrow(
      "Unsupported Computer task type",
    );
  });

  it("parses optional task statuses", () => {
    expect(parseComputerTaskStatus(undefined)).toBeUndefined();
    expect(parseComputerTaskStatus("COMPLETED")).toBe("completed");
  });

  it("normalizes workspace file write input", () => {
    expect(
      normalizeTaskInput("workspace_file_write", {
        path: "notes\\today.md",
        content: "hello",
      }),
    ).toEqual({ path: "notes/today.md", content: "hello" });
  });

  it("normalizes workspace file list/read/delete inputs", () => {
    expect(
      normalizeTaskInput("workspace_file_list", { ignored: true }),
    ).toBeNull();
    expect(
      normalizeTaskInput("workspace_file_read", { path: "USER.md" }),
    ).toEqual({ path: "USER.md" });
    expect(
      normalizeTaskInput("workspace_file_delete", { path: "memory/old.md" }),
    ).toEqual({ path: "memory/old.md" });
  });

  it("normalizes Computer-owned thread turn input", () => {
    expect(
      normalizeTaskInput("thread_turn", {
        threadId: "thread-1",
        messageId: "message-1",
        actorType: "user",
        actorId: "user-1",
      }),
    ).toEqual({
      threadId: "thread-1",
      messageId: "message-1",
      source: "chat_message",
      actorType: "user",
      actorId: "user-1",
      runbookRunId: null,
    });
    expect(
      normalizeTaskInput("thread_turn", {
        threadId: "thread-1",
        messageId: "message-1",
        source: "runbook",
        runbookRunId: "run-1",
      }),
    ).toEqual({
      threadId: "thread-1",
      messageId: "message-1",
      source: "runbook",
      actorType: null,
      actorId: null,
      runbookRunId: "run-1",
    });
  });

  it("normalizes Slack-originated thread turn input with the canonical envelope", () => {
    expect(
      normalizeTaskInput("thread_turn", {
        source: "slack",
        threadId: "thread-1",
        messageId: "message-1",
        channelType: "app_mention",
        slackTeamId: "T123",
        slackUserId: "U123",
        slackWorkspaceRowId: "workspace-1",
        triggerSurface: "app_mention",
        rootThreadTs: null,
        channelId: "C123",
        threadTs: "1710000001.000000",
        messageTs: "1710000001.000000",
        eventId: "Ev123",
        sourceMessage: {
          text: "help",
          ts: "1710000001.000000",
          user: "U123",
          channel: "C123",
          team: "T123",
          permalink: null,
        },
        threadContext: [{ user: "U123", botId: null, ts: "1", text: "help" }],
        fileRefs: [{ id: "F123", name: "brief.pdf" }],
        actorId: "user-1",
      }),
    ).toEqual(
      expect.objectContaining({
        source: "slack",
        threadId: "thread-1",
        messageId: "message-1",
        channelType: "app_mention",
        slackTeamId: "T123",
        slackUserId: "U123",
        triggerSurface: "app_mention",
        responseUrl: null,
        placeholderTs: null,
        modalViewId: null,
        actorType: "user",
        actorId: "user-1",
        slack: expect.objectContaining({
          slackTeamId: "T123",
          triggerSurface: "app_mention",
          sourceMessage: expect.objectContaining({ text: "help" }),
        }),
      }),
    );
  });

  it("preserves Slack slash command response_url metadata", () => {
    expect(
      normalizeTaskInput("thread_turn", {
        source: "slack",
        threadId: "thread-1",
        messageId: "message-1",
        channelType: "slash",
        slackTeamId: "T123",
        slackUserId: "U123",
        triggerSurface: "slash_command",
        rootThreadTs: null,
        channelId: "C123",
        threadTs: "slash:trigger-1",
        messageTs: "slash:trigger-1",
        eventId: "slash:trigger-1",
        sourceMessage: {
          text: "summarize",
          ts: "slash:trigger-1",
          user: "U123",
          channel: "C123",
          team: "T123",
          permalink: null,
        },
        responseUrl: "https://hooks.slack.com/commands/response",
        actorId: "user-1",
      }),
    ).toEqual(
      expect.objectContaining({
        source: "slack",
        channelType: "slash",
        eventId: "slash:trigger-1",
        responseUrl: "https://hooks.slack.com/commands/response",
        actorType: "user",
        actorId: "user-1",
      }),
    );
  });

  it("preserves Slack message-action modal metadata", () => {
    expect(
      normalizeTaskInput("thread_turn", {
        source: "slack",
        threadId: "thread-1",
        messageId: "message-1",
        channelType: "message_action",
        slackTeamId: "T123",
        slackUserId: "U123",
        triggerSurface: "message_action",
        rootThreadTs: "1710000000.000000",
        channelId: "C123",
        threadTs: "1710000000.000000",
        messageTs: "1710000001.000000",
        eventId: "message_action:trigger-1",
        sourceMessage: {
          text: "review this",
          ts: "1710000001.000000",
          user: "U456",
          channel: "C123",
          team: "T123",
          permalink: null,
        },
        responseUrl: "https://hooks.slack.com/actions/response",
        modalViewId: "V123",
        actorId: "user-1",
      }),
    ).toEqual(
      expect.objectContaining({
        source: "slack",
        channelType: "message_action",
        eventId: "message_action:trigger-1",
        responseUrl: "https://hooks.slack.com/actions/response",
        modalViewId: "V123",
        actorType: "user",
        actorId: "user-1",
      }),
    );
  });

  it("rejects Slack envelopes missing triggerSurface", () => {
    expect(() =>
      normalizeTaskInput("thread_turn", {
        source: "slack",
        threadId: "thread-1",
        messageId: "message-1",
        channelType: "app_mention",
        slackTeamId: "T123",
        slackUserId: "U123",
        channelId: "C123",
        threadTs: "1710000001.000000",
        messageTs: "1710000001.000000",
        eventId: "Ev123",
        sourceMessage: { text: "help" },
        actorId: "user-1",
      }),
    ).toThrow("triggerSurface is required");
  });

  it("normalizes runbook execution input", () => {
    expect(
      normalizeTaskInput("runbook_execute", {
        runbookRunId: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        actorType: "user",
        actorId: "user-1",
      }),
    ).toEqual({
      runbookRunId: "run-1",
      threadId: "thread-1",
      messageId: "message-1",
      actorType: "user",
      actorId: "user-1",
    });
  });

  it("rejects unsafe workspace paths", () => {
    expect(() => validateWorkspaceRelativePath("/tmp/out")).toThrow(
      "workspace-relative",
    );
    expect(() => validateWorkspaceRelativePath("notes/../out")).toThrow(
      "cannot contain",
    );
  });

  it("rejects oversized workspace file content", () => {
    expect(() =>
      normalizeTaskInput("workspace_file_write", {
        path: "large.txt",
        content: "x".repeat(256 * 1024 + 1),
      }),
    ).toThrow("bytes or less");
  });

  it("does not accept input for no-token smoke tasks", () => {
    expect(normalizeTaskInput("health_check", { ignored: true })).toBeNull();
    expect(
      normalizeTaskInput("google_cli_smoke", { token: "do-not-use" }),
    ).toBeNull();
    expect(
      normalizeTaskInput("google_workspace_auth_check", {
        token: "do-not-use",
      }),
    ).toBeNull();
  });

  it("normalizes Google Calendar upcoming input with safe bounds", () => {
    const normalized = normalizeTaskInput("google_calendar_upcoming", {
      timeMin: "2026-05-07T10:00:00.000Z",
      timeMax: "2026-05-20T10:00:00.000Z",
      maxResults: 500,
    });

    expect(normalized).toEqual({
      timeMin: "2026-05-07T10:00:00.000Z",
      timeMax: "2026-05-14T10:00:00.000Z",
      maxResults: 25,
    });
  });

  it("defaults Google Calendar upcoming input to a future window", () => {
    const normalized = normalizeTaskInput("google_calendar_upcoming", null);

    expect(typeof normalized?.timeMin).toBe("string");
    expect(typeof normalized?.timeMax).toBe("string");
    expect(normalized?.maxResults).toBe(10);
    expect(new Date(String(normalized?.timeMax)).getTime()).toBeGreaterThan(
      new Date(String(normalized?.timeMin)).getTime(),
    );
  });

  it("rejects invalid Google Calendar time ranges", () => {
    expect(() =>
      normalizeTaskInput("google_calendar_upcoming", {
        timeMin: "not-a-date",
      }),
    ).toThrow("timeMin must be an ISO timestamp");
    expect(() =>
      normalizeTaskInput("google_calendar_upcoming", {
        timeMin: "2026-05-07T10:00:00.000Z",
        timeMax: "2026-05-07T09:59:59.000Z",
      }),
    ).toThrow("timeMax must be after timeMin");
  });
});
