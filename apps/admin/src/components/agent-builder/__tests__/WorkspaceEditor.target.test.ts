import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  workspaceEditorActions,
  workspaceEditorCapabilities,
  workspaceEditorTargetKey,
} from "../WorkspaceEditor";

describe("workspace editor target capabilities", () => {
  it("does not expose retired template inheritance review capabilities", () => {
    expect(workspaceEditorCapabilities("agent")).toEqual({
      canReviewTemplateUpdates: false,
    });
    expect(workspaceEditorCapabilities("template")).toEqual({
      canReviewTemplateUpdates: false,
    });
    expect(workspaceEditorCapabilities("computer")).toEqual({
      canReviewTemplateUpdates: false,
    });
    expect(workspaceEditorCapabilities("context")).toEqual({
      canReviewTemplateUpdates: false,
    });
    expect(workspaceEditorCapabilities("defaults")).toEqual({
      canReviewTemplateUpdates: false,
    });
  });

  it("returns a flat new-file + new-folder action list for every mode", () => {
    for (const mode of [
      "agent",
      "template",
      "computer",
      "context",
      "defaults",
    ] as const) {
      expect(workspaceEditorActions(mode)).toEqual(["new-file", "new-folder"]);
    }
  });

  it("keys Computer targets by durable id instead of object identity", () => {
    expect(workspaceEditorTargetKey({ computerId: "computer-marco" })).toBe(
      "computer:computer-marco",
    );
    expect(workspaceEditorTargetKey({ computerId: "computer-marco" })).toBe(
      workspaceEditorTargetKey({ computerId: "computer-marco" }),
    );
  });

  it("keys requester context targets by user id", () => {
    expect(workspaceEditorTargetKey({ userId: "user-eric" })).toBe(
      "user:user-eric",
    );
  });

  it("has no toolbar entry points to gutted flows", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(editorSource).not.toMatch(/ImportDropzone/);
    expect(editorSource).not.toMatch(/AddSubAgentDialog/);
    expect(editorSource).not.toMatch(/from\s+["']\.\/snippets["']/);
    expect(editorSource).not.toMatch(/AGENT_WORKSPACE_DEFAULT_FILES/);
    expect(editorSource).not.toMatch(/FOLDER_TEMPLATES/);
    expect(editorSource).not.toMatch(
      /"New Skill"|"New Runbook Skill"|"Add from catalog"|"Add Runbook Skill"|"Bootstrap"|"Add Sub-agent"|"Snippets"|"Import bundle"|"Add docs\/ folder"|"Add procedures\/ folder"|"Add templates\/ folder"|"Add memory\/ folder"/,
    );
  });

  it("routes context-menu deletes through an AlertDialog confirmation", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );
    // FolderTree's onDelete must populate deleteConfirmTarget rather than
    // calling handleDeletePath directly, so the AlertDialog gates every
    // context-menu delete.
    expect(editorSource).toMatch(/onDelete=\{\(path, isFolder\)/);
    expect(editorSource).toMatch(
      /setDeleteConfirmTarget\(\{ path, isFolder \}\)/,
    );
    expect(editorSource).toMatch(/AlertDialogTitle/);
    expect(editorSource).toMatch(/DeleteConfirmDialog/);
  });
});
