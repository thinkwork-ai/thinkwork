import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  catalogShaBySlug,
  collectInstalledSkillRefPaths,
  computeSkillDriftByPath,
  parseCatalogRefSourceSha,
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
      buildWorkspaceTree([], {
        reservedRootFolders: workspaceEditorReservedRootFolders("catalog"),
      }),
    ).toEqual([]);
    expect(
      buildWorkspaceTree(["finance-audit-xls/SKILL.md"], {
        reservedRootFolders: workspaceEditorReservedRootFolders("catalog"),
      }).map((node) => node.path),
    ).toEqual(["finance-audit-xls"]);
  });

  it("keeps workspace and context reserved folder behavior", () => {
    expect(workspaceEditorReservedRootFolders("agent")).toBeUndefined();
    expect(workspaceEditorReservedRootFolders("context")).toEqual(["memory"]);
  });

  it("collects installed skill catalog refs from workspace file paths", () => {
    expect(
      collectInstalledSkillRefPaths([
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/draft-tool/SKILL.md",
        "memory/profile.md",
      ]),
    ).toEqual([
      {
        folderPath: "skills/finance-audit-xls",
        slug: "finance-audit-xls",
        refPath: "skills/finance-audit-xls/.catalog-ref.json",
      },
    ]);
  });

  it("parses catalog ref source hashes defensively", () => {
    expect(
      parseCatalogRefSourceSha(JSON.stringify({ source_sha256: "abc123" })),
    ).toBe("abc123");
    expect(parseCatalogRefSourceSha(JSON.stringify({}))).toBeNull();
    expect(parseCatalogRefSourceSha("{not-json")).toBeNull();
    expect(parseCatalogRefSourceSha(null)).toBeNull();
  });

  it("indexes catalog skill hashes by top-level slug", () => {
    expect(
      catalogShaBySlug([
        { path: "finance-audit-xls/SKILL.md", sha256: "finance-sha" },
        { path: "finance-audit-xls/WIRING.md", sha256: "ignored-later-sha" },
        { path: "calendar/SKILL.md", sha256: "calendar-sha" },
      ]),
    ).toEqual(
      new Map([
        ["finance-audit-xls", "finance-sha"],
        ["calendar", "calendar-sha"],
      ]),
    );
  });

  it("marks installed skills stale only when catalog hashes differ", () => {
    expect(
      computeSkillDriftByPath(
        [
          {
            folderPath: "skills/current",
            slug: "current",
            sourceSha256: "same",
          },
          {
            folderPath: "skills/old",
            slug: "old",
            sourceSha256: "old-sha",
          },
          {
            folderPath: "skills/manual",
            slug: "manual",
            sourceSha256: null,
          },
        ],
        new Map([
          ["current", "same"],
          ["old", "new-sha"],
          ["manual", "manual-sha"],
        ]),
      ),
    ).toEqual({ "skills/old": "stale" });
  });

  it("marks installed skills orphaned when their catalog slug disappears", () => {
    expect(
      computeSkillDriftByPath(
        [
          {
            folderPath: "skills/missing",
            slug: "missing",
            sourceSha256: "old-sha",
          },
        ],
        new Map(),
      ),
    ).toEqual({ "skills/missing": "orphan" });
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
    expect(editorSource).toMatch(/setDeleteConfirmTarget/);
    expect(editorSource).toMatch(/\{ kind: "path", path, isFolder \}/);
    expect(editorSource).not.toMatch(/onDeleteSyntheticGroup/);
    expect(editorSource).not.toMatch(/handleDeleteSyntheticGroup/);
    expect(editorSource).not.toMatch(/removeSyntheticRoutingRows/);
    expect(editorSource).not.toMatch(/replaceRoutingTable/);
    expect(editorSource).toMatch(/AlertDialogTitle/);
    expect(editorSource).toMatch(/DeleteConfirmDialog/);
  });

  it("wires Add Skill only through agent workspace targets", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(/AddSkillDialog/);
    expect(editorSource).toMatch(/"agentId" in stableTarget/);
    expect(editorSource).not.toMatch(
      /"spaceId" in stableTarget \? stableTarget/,
    );
    expect(editorSource).toMatch(/onAddSkill=/);
    expect(editorSource).toMatch(/setAddSkillDialogOpen\(true\)/);
    expect(editorSource).toMatch(/onInstalled=\{refreshFilesInBackground\}/);
  });

  it("routes installed skill folder removal through uninstall-skill", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );
    const apiSource = readFileSync(
      new URL("../../../lib/agent-builder-api.ts", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(/installedSkillSlugForPath/);
    expect(editorSource).toMatch(/\.catalog-ref\.json/);
    expect(editorSource).toMatch(/kind: "skill"/);
    expect(editorSource).toMatch(/onRemoveSkill=/);
    expect(editorSource).toMatch(/handleRemoveSkill/);
    expect(editorSource).toMatch(/agentBuilderApi\.uninstallSkill/);
    expect(apiSource).toMatch(/uninstallWorkspaceSkill/);
    expect(apiSource).toMatch(/uninstallSkill/);
  });

  it("routes stale installed skill refresh through reinstall-skill", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );
    const treeSource = readFileSync(
      new URL("../FolderTree.tsx", import.meta.url),
      "utf8",
    );
    const apiSource = readFileSync(
      new URL("../../../lib/agent-builder-api.ts", import.meta.url),
      "utf8",
    );

    expect(treeSource).toMatch(/onReinstallSkill/);
    expect(treeSource).toMatch(/Reinstall Skill/);
    expect(treeSource).toMatch(
      /skillDriftByPath\?\.\[node\.path\] === "stale"/,
    );
    expect(editorSource).toMatch(/handleReinstallSkill/);
    expect(editorSource).toMatch(/agentBuilderApi\.reinstallSkill/);
    expect(editorSource).toMatch(/onReinstallSkill=/);
    expect(apiSource).toMatch(/reinstallWorkspaceSkill/);
    expect(apiSource).toMatch(/reinstallSkill/);
  });

  it("closes the context-menu delete dialog before starting deletion", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(editorSource).toMatch(
      /setDeleteConfirmTarget\(null\);\s+if \(target\.kind === "skill"\)/,
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

  it("supports opt-in default file selection without choosing arbitrary files", () => {
    const editorSource = readFileSync(
      new URL("../WorkspaceEditor.tsx", import.meta.url),
      "utf8",
    );
    const agentWorkspaceSource = readFileSync(
      new URL(
        "../../tenant-agent/TenantAgentWorkspaceTab.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const spaceChromeSource = readFileSync(
      new URL("../../spaces/SpaceDetailChrome.tsx", import.meta.url),
      "utf8",
    );
    const userRouteSource = readFileSync(
      new URL(
        "../../../routes/_authed/_tenant/users/$userId.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const userKnowledgeSource = readFileSync(
      new URL(
        "../../../routes/_authed/_tenant/knowledge/user.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(editorSource).toMatch(/defaultOpenFile\?: string/);
    expect(editorSource).toMatch(/openFileRef\.current = filePath/);
    expect(editorSource).toMatch(/!files\.includes\(defaultOpenFile\)/);
    expect(editorSource).toMatch(/openFileRef\.current !== null/);
    expect(editorSource).toMatch(/requestOpenWorkspaceFile\(defaultOpenFile\)/);
    expect(editorSource).not.toMatch(/files\[0\]/);
    expect(agentWorkspaceSource).toContain('defaultOpenFile="AGENTS.md"');
    expect(spaceChromeSource).toContain('defaultOpenFile="SPACE.md"');
    expect(userRouteSource).toContain('defaultOpenFile="USER.md"');
    expect(userKnowledgeSource).not.toContain("defaultOpenFile");
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
    expect(editorSource).toMatch(
      /regenerateMap\(stableTarget\.agentId, path\)/,
    );
    expect(editorSource).toMatch(/path\.endsWith\("\/AGENTS\.md"\)/);
    expect(editorSource).toMatch(/onRegenerateMap=/);
    expect(editorSource).toMatch(/handleGenerateFolderStructure/);
    expect(editorSource).toMatch(/agentBuilderApi\.generateFolderStructure/);
    expect(editorSource).toMatch(/onGenerateFolderStructure=/);
    expect(editorSource).toMatch(
      /"agentId" in stableTarget \|\| "spaceId" in stableTarget/,
    );
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
