import { describe, expect, it } from "vitest";
import { IconFlask } from "@tabler/icons-react";
import {
  SETTINGS_NAV_ITEMS,
  settingsCrumbForPath,
  visibleSettingsNavItems,
} from "./settings-nav";

const ACTIVITY = "/settings/activity";
const KNOWLEDGE_GRAPH = "/settings/knowledge-graph";
const KNOWLEDGE_BASES = "/settings/knowledge-bases";
const BILLING = "/settings/billing";
const AGENTS = "/settings/agents";
const MODEL_CATALOG = "/settings/model-catalog";
const EVALUATIONS = "/settings/evaluations";
const ARTIFACTS = "/settings/artifacts";
const WORKFLOWS = "/settings/workflows";

describe("visibleSettingsNavItems", () => {
  it("no longer lists a standalone Main Agent entry (editor lives on Agents)", () => {
    // The agent-source editor is the workspace view of the Agents page
    // (/settings/agents?view=workspace); /settings/main-agent redirects there.
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/main-agent"),
    ).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Main Agent")).toBe(
      false,
    );
  });

  it("no longer lists the consolidated Workspace entry (route redirects)", () => {
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/local-workspace"),
    ).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Workspace")).toBe(false);
  });

  it("shows personal Connections alongside General and Activity for members", () => {
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
    });

    expect(memberWeb.map((i) => i.label)).toEqual([
      "Activity",
      "Connectors",
      "General",
    ]);
    expect(memberWeb.some((i) => i.to === "/settings/users")).toBe(false);
  });

  it("does not list Billing in navigation (route kept, hidden from sidebar)", () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === BILLING)).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Billing")).toBe(false);
  });

  it("lists Artifacts for operators (Living Artifacts, THINK-145)", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === ARTIFACTS);
    expect(item).toBeDefined();
    expect(item?.label).toBe("Artifacts");
    expect(item?.operatorOnly).toBe(true);
  });

  it("labels the agent home Agents on /settings/agents; Composer entry retired (U7)", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === "/settings/agents");
    expect(item).toBeDefined();
    expect(item?.label).toBe("Agents");
    expect(item?.operatorOnly).toBe(true);
    // The Composer nav entry collapsed into the Agent page; the route now
    // redirects, so no nav item may point at it.
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/capabilities"),
    ).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Composer")).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Capabilities")).toBe(
      false,
    );
  });

  it("shows Agents to operators and hides it for members", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === AGENTS);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBe(true);

    const operatorWeb = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
    });
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
    });

    expect(operatorWeb.some((i) => i.to === AGENTS)).toBe(true);
    expect(memberWeb.some((i) => i.to === AGENTS)).toBe(false);
  });

  it("labels the MCP-servers section Connectors (THINK-285)", () => {
    const item = SETTINGS_NAV_ITEMS.find(
      (i) => i.to === "/settings/mcp-servers",
    );
    expect(item).toBeDefined();
    expect(item?.label).toBe("Connectors");
    expect(item?.operatorOnly).toBeUndefined();
    // The old sidebar label is gone; only the per-user tab inside the page
    // keeps the "Connections" name.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Connections")).toBe(
      false,
    );
    expect(settingsCrumbForPath("/settings/mcp-servers/data-sources")).toEqual([
      { label: "Connectors" },
    ]);
  });

  it("no longer lists a standalone Webhooks nav entry (THINK-137 U8)", () => {
    // Every webhook is now an Automation with a `webhook` trigger, managed
    // under Automations. The /settings/webhooks routes remain as redirects.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/webhooks")).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Webhooks")).toBe(false);
  });

  it("uses the flask icon for Evaluations", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === EVALUATIONS);
    expect(item).toBeDefined();
    expect(item?.icon).toBe(IconFlask);
  });

  it("collapses Automations and Routines into a single Workflows nav entry (THINK-218)", () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Automations")).toBe(
      false,
    );
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/automations"),
    ).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Routines")).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/routines")).toBe(
      false,
    );

    const item = SETTINGS_NAV_ITEMS.find((i) => i.label === "Workflows");
    expect(item).toBeDefined();
    expect(item?.to).toBe(WORKFLOWS);
    expect(item?.operatorOnly).toBe(true);
    expect(settingsCrumbForPath(WORKFLOWS)).toEqual([{ label: "Workflows" }]);
  });

  it("shows Model Catalog to operators and hides it for members", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === MODEL_CATALOG);
    expect(item).toBeDefined();
    expect(item?.label).toBe("Model Catalog");
    expect(item?.operatorOnly).toBe(true);

    const operatorWeb = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
    });
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
    });

    expect(operatorWeb.some((i) => i.to === MODEL_CATALOG)).toBe(true);
    expect(memberWeb.some((i) => i.to === MODEL_CATALOG)).toBe(false);
    expect(settingsCrumbForPath(MODEL_CATALOG)).toEqual([
      { label: "Model Catalog" },
    ]);
  });

  it("no longer lists a standalone Knowledge Graph nav entry", () => {
    // The Knowledge Graph explorer is now a tab of the Memory page.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Knowledge Graph")).toBe(
      false,
    );
  });

  it("carries no managed-app nav guards", () => {
    for (const item of SETTINGS_NAV_ITEMS) {
      expect("managedAppKey" in item).toBe(false);
    }
  });

  it("no longer lists a standalone Knowledge Bases nav entry", () => {
    // Knowledge Bases is a tab of the Memory page using the legacy route.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === KNOWLEDGE_BASES)).toBe(
      false,
    );
  });

  it("collapses the memory family to a single Memory entry", () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/memory")).toBe(
      true,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/wiki")).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Wiki Memory")).toBe(
      false,
    );
  });

  it("carries no Plugins or Applications nav entry", () => {
    // The plugin system and its Applications projection are gone: third-party
    // applications are white-glove installed, not self-serve managed.
    for (const label of ["Plugins", "Applications"]) {
      expect(SETTINGS_NAV_ITEMS.some((i) => i.label === label)).toBe(false);
    }
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.to.startsWith("/settings/plugins")),
    ).toBe(false);
  });

  it("places Activity in Spaces settings for operators and members", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === ACTIVITY);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBeFalsy();

    const operator = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
    });
    const member = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
    });

    expect(operator.some((i) => i.to === ACTIVITY)).toBe(true);
    expect(member.some((i) => i.to === ACTIVITY)).toBe(true);
  });

  it("no longer lists a standalone Analytics nav entry", () => {
    // Analytics is now the default tab of the Activity page, reached by drilling
    // into Activity rather than its own sidebar section.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/analytics")).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Analytics")).toBe(false);
  });

  it("alphabetises every section by label (no pinned entries)", () => {
    // Strict alpha order (Eric 2026-07-22) — General is not pinned; the
    // default section is Activity via the /settings index redirect.
    const labels = SETTINGS_NAV_ITEMS.map((i) => i.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sorted);
  });
});
