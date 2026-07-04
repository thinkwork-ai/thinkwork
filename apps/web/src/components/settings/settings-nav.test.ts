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
const CRM = "/settings/crm";
const MANAGED_APPLICATIONS = "/settings/managed-applications";
const BILLING = "/settings/billing";
const AGENTS = "/settings/agents";
const MODEL_CATALOG = "/settings/model-catalog";
const EVALUATIONS = "/settings/evaluations";
const AUTOMATIONS = "/settings/automations";
const ARTIFACTS = "/settings/artifacts";

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

  it("shows only General, Activity, and Plugins for members", () => {
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });

    expect(memberWeb.map((i) => i.label)).toEqual([
      "General",
      "Activity",
      "Plugins",
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
      isDesktop: false,
    });
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });

    expect(operatorWeb.some((i) => i.to === AGENTS)).toBe(true);
    expect(memberWeb.some((i) => i.to === AGENTS)).toBe(false);
  });

  it("uses the flask icon for Evaluations", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === EVALUATIONS);
    expect(item).toBeDefined();
    expect(item?.icon).toBe(IconFlask);
  });

  it("uses Automations as the user-facing automation route", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.label === "Automations");
    expect(item).toBeDefined();
    expect(item?.to).toBe(AUTOMATIONS);
    expect(item?.operatorOnly).toBe(true);
    expect(settingsCrumbForPath(AUTOMATIONS)).toEqual([
      { label: "Automations" },
    ]);
  });

  it("shows Model Catalog to operators and hides it for members", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === MODEL_CATALOG);
    expect(item).toBeDefined();
    expect(item?.label).toBe("Model Catalog");
    expect(item?.operatorOnly).toBe(true);

    const operatorWeb = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: false,
    });
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
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

  it("no longer lists standalone CRM or Knowledge Bases nav entries", () => {
    // CRM is reached by drilling in from Applications; Knowledge Bases is a tab
    // of the Memory page using the legacy knowledge-base route.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === CRM)).toBe(false);
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

  it("retires the Applications nav item (superseded by Plugins)", () => {
    // The managed-applications surface left the nav — Plugins supersedes it.
    // The route still resolves by URL, so the breadcrumb falls back to the
    // generic settings label.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === MANAGED_APPLICATIONS)).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Applications")).toBe(
      false,
    );
    expect(settingsCrumbForPath(MANAGED_APPLICATIONS)).toEqual([
      { label: "Settings" },
    ]);
  });

  it("places Activity in Spaces settings for operators and members", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === ACTIVITY);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBeFalsy();
    expect(item?.desktopOnly).toBeFalsy();

    const operatorWeb = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: false,
    });
    const operatorDesktop = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: true,
    });
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });

    expect(operatorWeb.some((i) => i.to === ACTIVITY)).toBe(true);
    expect(operatorDesktop.some((i) => i.to === ACTIVITY)).toBe(true);
    expect(memberWeb.some((i) => i.to === ACTIVITY)).toBe(true);
  });

  it("no longer lists a standalone Analytics nav entry", () => {
    // Analytics is now the default tab of the Activity page, reached by drilling
    // into Activity rather than its own sidebar section.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/analytics")).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Analytics")).toBe(false);
  });

  it("pins General first and alphabetises the rest by label", () => {
    // General is the only fixed entry; every other section sorts by label so the
    // growing operator list stays scannable.
    expect(SETTINGS_NAV_ITEMS[0]?.to).toBe("/settings/general");

    const rest = SETTINGS_NAV_ITEMS.slice(1).map((i) => i.label);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sorted);
  });
});
