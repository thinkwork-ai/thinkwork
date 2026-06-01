import { describe, expect, it } from "vitest";
import {
  isGeneratedWorkspaceProjection,
  workspacePathContract,
  workspacePathOwner,
  workspaceSourcePath,
} from "./workspace-lanes.js";

describe("workspace contract v1 lane mapping", () => {
  it("maps rendered Agent, User, Space, and Thread notes paths to owners", () => {
    expect(workspacePathOwner("AGENTS.md")).toBe("agent");
    expect(workspacePathOwner("CONTEXT.md")).toBe("agent");
    expect(workspacePathOwner("memory/preferences.md")).toBe("agent");
    expect(workspacePathOwner("skills/reporting/SKILL.md")).toBe("agent");
    expect(workspacePathOwner("User/USER.md")).toBe("user");
    expect(workspacePathOwner("User/memory/preferences.md")).toBe("user");
    expect(workspacePathOwner("Spaces/customer/docs/a.md")).toBe("space");
    expect(workspacePathOwner("Spaces/customer/workflows/onboard.md")).toBe(
      "space",
    );
    expect(workspacePathOwner("Thread/notes/finding.md")).toBe("thread_notes");
  });

  it("keeps write-back source paths relative to the backing owner lane", () => {
    expect(workspaceSourcePath("AGENTS.md")).toBe("AGENTS.md");
    expect(workspaceSourcePath("User/USER.md")).toBe("USER.md");
    expect(workspaceSourcePath("Spaces/customer/docs/a.md")).toBe("docs/a.md");
    expect(workspaceSourcePath("Thread/notes/finding.md")).toBe(
      "notes/finding.md",
    );
  });

  it("marks generated v1 projections as read-only instead of writable files", () => {
    for (const path of [
      "Spaces/INDEX.md",
      "Thread/THREAD.md",
      "Thread/GOAL.md",
      "Thread/PROGRESS.md",
      "Thread/TASKS.md",
    ]) {
      expect(isGeneratedWorkspaceProjection(path)).toBe(true);
      expect(workspacePathContract(path)).toMatchObject({
        owner: "status",
        writeLane: "generated_read_only",
        readOnly: true,
        generated: true,
      });
    }
  });

  it("returns writable lanes for durable v1 source-backed paths", () => {
    expect(workspacePathContract("AGENTS.md")).toMatchObject({
      owner: "agent",
      writeLane: "agent_source",
      readOnly: false,
    });
    expect(workspacePathContract("User/memory/preferences.md")).toMatchObject({
      owner: "user",
      writeLane: "user_source",
      readOnly: false,
    });
    expect(
      workspacePathContract("Spaces/customer/plans/kickoff.md"),
    ).toMatchObject({
      owner: "space",
      writeLane: "space_source",
      readOnly: false,
    });
    expect(workspacePathContract("Thread/notes/findings.md")).toMatchObject({
      owner: "thread_notes",
      writeLane: "thread_notes",
      readOnly: false,
    });
  });
});
