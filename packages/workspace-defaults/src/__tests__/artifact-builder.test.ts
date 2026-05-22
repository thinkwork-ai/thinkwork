import { describe, expect, it } from "vitest";
import { loadDefaults } from "../index.js";

const defaults = loadDefaults();
const skill = defaults["skills/artifact-builder/SKILL.md"];
const crmRecipe =
  defaults["skills/artifact-builder/references/crm-dashboard.md"];

describe("Artifact Builder defaults", () => {
  it("teaches the agent the artifact contract without legacy runbook bridges", () => {
    expect(skill).toContain("Do not use `delegate` or `delegate_to_workspace`");
    expect(skill).toContain("save_app");
    expect(skill).toContain("/artifacts/{appId}");
    expect(skill).toContain("host-provided Artifact chrome");
    expect(skill).toContain("sandboxed iframe runtime");
    expect(skill).toContain("Your TSX should render only the app body");
    expect(skill).toContain("Never use emoji as icons");
    expect(skill).toContain("not prose-only markdown reports");
    expect(skill).toContain("KPIs must use `KpiStrip`");
    expect(skill).toContain("Do not hand-compose KPI metrics");
    expect(skill).toContain("do not rely on generated `grid-cols-*`");
    // Runbook-bridge framing was removed in PR #1548; this skill no longer
    // doubles as a compatibility shim for the (now-deprecated) runbook concept.
    expect(skill).not.toContain("compatibility shim");
    expect(skill).not.toContain("Runbook Bridge");
    expect(skill).not.toContain("runbook phase guidance");
  });

  it("requires on-demand shadcn lookups instead of pre-enumerating the registry", () => {
    expect(skill).toContain("fast unsaved app preview first");
    expect(skill).toContain("Look up shadcn components on demand");
    expect(skill).toContain("get_component_source");
    expect(skill).toContain("get_block");
    expect(skill).toContain(
      "packages/ui/registry/generated-app-components.json",
    );
    expect(skill).toContain("shadcn_registry");
    expect(skill).toContain("structured guidance error");
    expect(skill).toContain("You must use approved shadcn primitives");
    expect(skill).toContain("Hand-rolled replacements");
    expect(skill).toContain("preview_app");
    expect(skill).toContain("uiRegistryVersion");
    expect(skill).toContain("uiRegistryDigest");
    expect(skill).toContain("shadcnMcpToolCalls");
    expect(skill).toContain('["local_registry_fallback"]');
    expect(skill).toContain("same generated-app policy");
    // The agent must NOT be told to consult/enumerate the registry up front.
    // That phrasing caused the 31-parallel-call deadlock on thread fc4328eb.
    expect(skill).not.toContain("consult the shadcn registry source");
    expect(skill).not.toContain(
      "Before writing TSX, consult the shadcn registry",
    );
  });

  it("delegates domain layout to the domain skill, not the parent skill", () => {
    expect(skill).toContain("Composing With Domain Skills");
    expect(skill).toContain("crm-dashboard");
    expect(skill).toContain("research-dashboard");
    expect(skill).toContain("map-artifact");
    // CRM-specific reference loading was moved out of the parent contract; the
    // domain skill owns that routing decision now.
    expect(skill).not.toContain(
      "load and follow `skills/artifact-builder/references/crm-dashboard.md`",
    );
  });

  it("allows bounded lucide-react icon imports for generated apps", () => {
    expect(skill).toContain("lucide-react");
    expect(skill).toContain("named icon imports");
    expect(skill).not.toContain("Import icons from `lucide-react`");
    expect(skill).not.toContain("@tabler/icons-react");
  });

  it("defines the CRM dashboard applet contract", () => {
    expect(crmRecipe).toContain("interface CrmDashboardData");
    expect(crmRecipe).toContain("sourceStatuses");
    expect(crmRecipe).toContain("stageExposure");
    expect(crmRecipe).toContain("staleActivity");
    expect(crmRecipe).toContain("topRisks");
    expect(crmRecipe).toContain("export async function refresh()");
    expect(crmRecipe).toContain("save_app");
    expect(crmRecipe).toContain("/artifacts/{appId}");
    expect(crmRecipe).toContain("Render the dashboard body only");
    expect(crmRecipe).toContain("do not add a duplicate app shell");
    expect(crmRecipe).toContain("source coverage panel");
    expect(crmRecipe).toContain("unless the user explicitly requests it");
    expect(crmRecipe).toContain("operational CRM dashboard");
    expect(crmRecipe).toContain("dense LastMile-style sales dashboard");
    expect(crmRecipe).toContain("Do not use emoji as icons");
    expect(crmRecipe).toContain("sortable/scannable table");
    expect(crmRecipe).toContain("reject the draft and revise it");
    expect(crmRecipe).toContain("KPIs must use `KpiStrip`");
    expect(crmRecipe).toContain(
      "Do not create a vertical stack of full-width KPI cards",
    );
    expect(crmRecipe).toContain(
      "core dashboard layout depends on `grid-cols-*`",
    );
  });

  it("keeps host chrome and provenance guidance out of default app bodies", () => {
    expect(skill).toContain("Do not create an outer artifact card");
    expect(skill).toContain("source coverage, evidence, or provenance panel");
    expect(skill).not.toContain(
      "Header with title, summary, and source badges",
    );
    expect(crmRecipe).not.toContain("Header: title, summary");
  });
});
