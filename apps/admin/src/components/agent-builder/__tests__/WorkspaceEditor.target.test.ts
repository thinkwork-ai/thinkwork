import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  workspaceEditorActions,
  workspaceEditorCapabilities,
  workspaceEditorTargetKey,
} from "../WorkspaceEditor";

describe("workspace editor target capabilities", () => {
  it("keeps agent-only import and template-update review on agent targets", () => {
    expect(workspaceEditorCapabilities("agent")).toMatchObject({
      canImportBundle: true,
      canReviewTemplateUpdates: true,
      canAddSubAgent: true,
      canCreateLocalSkill: true,
    });
    expect(workspaceEditorActions("agent")).toContain("import-bundle");
  });

  it("keeps template workspace authoring but hides agent-only import", () => {
    expect(workspaceEditorCapabilities("template")).toMatchObject({
      canImportBundle: false,
      canReviewTemplateUpdates: false,
      canAddSubAgent: true,
      canCreateLocalSkill: true,
    });
    expect(workspaceEditorActions("template")).not.toContain("import-bundle");
  });

  it("treats Computer workspaces as direct file editing surfaces", () => {
    expect(workspaceEditorCapabilities("computer")).toMatchObject({
      canImportBundle: false,
      canReviewTemplateUpdates: false,
      canAddSubAgent: false,
      canCreateLocalSkill: true,
      canAddCatalogSkill: false,
      canBootstrapDefaults: false,
    });
    expect(workspaceEditorActions("computer")).toEqual([
      "new-skill",
      "new-file",
      "add-docs-folder",
      "add-procedures-folder",
      "add-templates-folder",
      "add-memory-folder",
    ]);
  });

  it("keys Computer targets by durable id instead of object identity", () => {
    expect(workspaceEditorTargetKey({ computerId: "computer-marco" })).toBe(
      "computer:computer-marco",
    );
    expect(workspaceEditorTargetKey({ computerId: "computer-marco" })).toBe(
      workspaceEditorTargetKey({ computerId: "computer-marco" }),
    );
  });

  it("limits defaults to file and folder authoring", () => {
    expect(workspaceEditorCapabilities("defaults")).toMatchObject({
      canImportBundle: false,
      canReviewTemplateUpdates: false,
      canAddSubAgent: false,
      canCreateLocalSkill: false,
      canBootstrapDefaults: true,
    });
    expect(workspaceEditorActions("defaults")).toEqual([
      "new-file",
      "add-docs-folder",
      "add-procedures-folder",
      "add-templates-folder",
      "add-memory-folder",
      "bootstrap",
    ]);
  });

  it("keeps template workspace routes on the shared editor", () => {
    const routeFiles = [
      "../../../routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx",
      "../../../routes/_authed/_tenant/agent-templates/defaults.tsx",
    ];
    const routeSource = routeFiles
      .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n");

    expect(routeSource).toContain("WorkspaceEditor");
    expect(routeSource).not.toMatch(
      /CodeMirror|WsTreeItem|buildTree|wsSelectedFile|wsContent|markdownLanguage|vscodeDark/,
    );
  });
});
