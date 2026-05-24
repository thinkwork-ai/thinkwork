import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  workspaceEditorActions,
  workspaceEditorCapabilities,
  workspaceEditorReservedRootFolders,
  workspaceEditorTargetKey,
} from "../WorkspaceEditor";
import { buildWorkspaceTree } from "../FolderTree";

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
    expect(workspaceEditorCapabilities("catalog")).toEqual({
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
      "catalog",
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

  it("keys Space source targets by durable id", () => {
    expect(workspaceEditorTargetKey({ spaceId: "space-eng" })).toBe(
      "space:space-eng",
    );
  });

  it("keys the tenant catalog target distinctly", () => {
    expect(workspaceEditorTargetKey({ catalog: true })).toBe("catalog");
  });

  it("does not synthesize workspace skills folders in catalog mode", () => {
    expect(workspaceEditorReservedRootFolders("catalog")).toEqual([]);
    expect(
      buildWorkspaceTree([], [], {
        reservedRootFolders: workspaceEditorReservedRootFolders("catalog"),
      }),
    ).toEqual([]);
    expect(
      buildWorkspaceTree(["finance-audit-xls/SKILL.md"], [], {
        reservedRootFolders: workspaceEditorReservedRootFolders("catalog"),
      }).map((node) => node.path),
    ).toEqual(["finance-audit-xls"]);
  });

  it("keeps workspace and context reserved folder behavior", () => {
    expect(workspaceEditorReservedRootFolders("agent")).toBeUndefined();
    expect(workspaceEditorReservedRootFolders("context")).toEqual(["memory"]);
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

  it("closes the context-menu delete dialog before starting deletion", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(
      /setDeleteConfirmTarget\(null\);\s+void handleDeletePath\(path, isFolder\);/,
    );
  });

  it("registers Cmd/Ctrl+S only for dirty editor saves", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(/event\.key\.toLowerCase\(\) === "s"/);
    expect(editorSource).toMatch(/event\.metaKey \|\| event\.ctrlKey/);
    expect(editorSource).toMatch(/editValue === content/);
    expect(editorSource).toMatch(
      /event\.preventDefault\(\);\s+void handleSave\(\);/,
    );
  });

  it("keeps save and discard hidden until the open file is dirty", () => {
    const paneSource = readFileSync(
      new URL("../FileEditorPane.tsx", import.meta.url),
      "utf8",
    );

    expect(paneSource).toMatch(/const hasPendingChanges = value !== content/);
    expect(paneSource).toMatch(/!loading && hasPendingChanges/);
    expect(paneSource).toMatch(/Save/);
    expect(paneSource).toMatch(/Discard/);
  });

  it("does not expose a header delete button in the file editor", () => {
    const paneSource = readFileSync(
      new URL("../FileEditorPane.tsx", import.meta.url),
      "utf8",
    );

    expect(paneSource).not.toMatch(/Trash2/);
    expect(paneSource).not.toMatch(/onConfirmDelete/);
    expect(paneSource).not.toMatch(/onCancelDeleteConfirm/);
    expect(paneSource).not.toMatch(/aria-label=.*Delete file/);
  });

  it("guards file switches and route navigation when the editor is dirty", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(/useBlocker/);
    expect(editorSource).toMatch(/hasPendingChanges/);
    expect(editorSource).toMatch(/requestOpenWorkspaceFile/);
    expect(editorSource).toMatch(/setPendingFileSwitchPath\(filePath\)/);
    expect(editorSource).toMatch(/navigationBlocker\.status === "blocked"/);
    expect(editorSource).toMatch(/PendingChangesDialog/);
    expect(editorSource).toMatch(/Discard unsaved changes\?/);
    expect(editorSource).toMatch(/navigationBlocker\.proceed\(\)/);
    expect(editorSource).toMatch(/navigationBlocker\.reset\(\)/);
  });

  it("uses inline tree editing for new files, new folders, and rename", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(/inlineEdit/);
    expect(editorSource).toMatch(/startNewFile/);
    expect(editorSource).toMatch(/startNewFolder/);
    expect(editorSource).toMatch(/startRename/);
    expect(editorSource).toMatch(/onRename=\{startRename\}/);
    expect(editorSource).toMatch(/onNewFolder=\{startNewFolder\}/);
    expect(editorSource).toMatch(/handleRegenerateMap/);
    expect(editorSource).toMatch(/agentBuilderApi\.regenerateMap/);
    expect(editorSource).toMatch(/onRegenerateMap=/);
    expect(editorSource).toMatch(/handleGenerateFolderStructure/);
    expect(editorSource).toMatch(/agentBuilderApi\.generateFolderStructure/);
    expect(editorSource).toMatch(/onGenerateFolderStructure=/);
    expect(editorSource).toMatch(
      /if \(isOpenTarget\) setLoadingContent\(true\)/,
    );
    expect(editorSource).toMatch(/renamePath/);
    expect(editorSource).toMatch(/replacePathPrefix/);
    expect(editorSource).toMatch(/mode: "new-folder"/);
    expect(editorSource).toMatch(/\$\{path\}\/\.gitkeep/);
    expect(editorSource).toMatch(/key: "F2"/);
    expect(editorSource).not.toMatch(/showNewFileDialog/);
    expect(editorSource).not.toMatch(/showNewFolderDialog/);
    expect(editorSource).not.toMatch(/openNewFolderDialog/);
    expect(editorSource).not.toMatch(/<DialogTitle>New File<\/DialogTitle>/);
    expect(editorSource).not.toMatch(/<DialogTitle>New Folder<\/DialogTitle>/);
  });
});
