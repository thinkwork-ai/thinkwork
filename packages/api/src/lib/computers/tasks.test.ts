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
    expect(parseComputerTaskType("CONNECTOR_WORK")).toBe("connector_work");
    expect(parseComputerTaskType("THREAD_TURN")).toBe("thread_turn");
    expect(parseComputerTaskType("GOOGLE_CLI_SMOKE")).toBe("google_cli_smoke");
    expect(parseComputerTaskType("GOOGLE_WORKSPACE_AUTH_CHECK")).toBe(
      "google_workspace_auth_check",
    );
    expect(parseComputerTaskType("GOOGLE_CALENDAR_UPCOMING")).toBe(
      "google_calendar_upcoming",
    );
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

  it("normalizes connector work input", () => {
    expect(
      normalizeTaskInput("connector_work", {
        connectorId: "connector-1",
        connectorExecutionId: "execution-1",
        externalRef: "TECH-101",
        title: "Handle task",
        body: "Linear issue body",
        metadata: { sourceKind: "tracker_issue" },
      }),
    ).toEqual({
      connectorId: "connector-1",
      connectorExecutionId: "execution-1",
      externalRef: "TECH-101",
      title: "Handle task",
      body: "Linear issue body",
      metadata: { sourceKind: "tracker_issue" },
    });
  });

  it("rejects malformed connector work input", () => {
    expect(() =>
      normalizeTaskInput("connector_work", {
        connectorId: "connector-1",
        externalRef: "TECH-101",
        title: "Handle task",
        body: "Linear issue body",
      }),
    ).toThrow("connectorExecutionId is required");
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
