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
    expect(parseComputerTaskType("GOOGLE_CLI_SMOKE")).toBe("google_cli_smoke");
    expect(parseComputerTaskType("GOOGLE_WORKSPACE_AUTH_CHECK")).toBe(
      "google_workspace_auth_check",
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
});
