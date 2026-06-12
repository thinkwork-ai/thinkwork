import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_ITEMS,
  settingsCrumbForPath,
  visibleSettingsNavItems,
} from "./settings-nav";

const MAIN_AGENT = "/settings/main-agent";
const ACTIVITY = "/settings/activity";
const KNOWLEDGE_GRAPH = "/settings/knowledge-graph";
const KNOWLEDGE_BASES = "/settings/knowledge-bases";
const CRM = "/settings/crm";
const MANAGED_APPLICATIONS = "/settings/managed-applications";
const BILLING = "/settings/billing";
const AGENTS = "/settings/agents";
const MODEL_CATALOG = "/settings/model-catalog";

describe("visibleSettingsNavItems", () => {
  it("declares Main Agent as a non-operator, non-desktop-gated section", () => {
    // The S3-backed editor works in any build; editing is gated to owner/admin
    // inside the view (readOnly), not by hiding the nav entry.
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === MAIN_AGENT);
    expect(item).toBeDefined();
    expect(item?.label).toBe("Main Agent");
    expect(item?.desktopOnly).toBeFalsy();
    expect(item?.operatorOnly).toBeFalsy();
  });

  it("no longer lists the consolidated Workspace entry (route redirects)", () => {
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.to === "/settings/local-workspace"),
    ).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Workspace")).toBe(false);
  });

  it("shows Main Agent on the web build for any role", () => {
    const items = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });
    expect(items.some((i) => i.to === MAIN_AGENT)).toBe(true);
  });

  it("shows Main Agent on desktop builds too", () => {
    const items = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: true,
    });
    expect(items.some((i) => i.to === MAIN_AGENT)).toBe(true);
  });

  it("still gates operator-only sections independently of Main Agent", () => {
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });
    // An operator-only section (Users) stays hidden for a non-operator, while
    // Main Agent shows for everyone.
    expect(memberWeb.some((i) => i.to === "/settings/users")).toBe(false);
    expect(memberWeb.some((i) => i.to === MAIN_AGENT)).toBe(true);
  });

  it("does not list Billing in navigation (route kept, hidden from sidebar)", () => {
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === BILLING)).toBe(false);
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Billing")).toBe(false);
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
    // The Knowledge Graph explorer is now a tab of the Memory page; Cognee's
    // config lives at Applications > Cognee.
    expect(SETTINGS_NAV_ITEMS.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(
      false,
    );
    expect(SETTINGS_NAV_ITEMS.some((i) => i.label === "Knowledge Graph")).toBe(
      false,
    );
  });

  it("carries no twenty managed-app nav guard (U10: Twenty lives under Plugins)", () => {
    // The managedAppKey guard mechanism is Cognee-only now; a stale
    // 'twenty' guard would go permanently false once the env-served
    // runtime flag retired, silently hiding its section.
    for (const item of SETTINGS_NAV_ITEMS) {
      expect(
        item.managedAppKey === undefined || item.managedAppKey === "cognee",
      ).toBe(true);
    }
  });

  it("no longer lists standalone CRM or Knowledge Bases nav entries", () => {
    // CRM is reached by drilling in from Applications; Knowledge Bases is a tab
    // of the Memory page.
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

  it("renames Managed Applications to Applications (route path unchanged)", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === MANAGED_APPLICATIONS);
    expect(item).toBeDefined();
    expect(item?.label).toBe("Applications");
    expect(
      SETTINGS_NAV_ITEMS.some((i) => i.label === "Managed Applications"),
    ).toBe(false);
    // Breadcrumb root derives from the renamed nav label.
    expect(settingsCrumbForPath(MANAGED_APPLICATIONS)).toEqual([
      { label: "Applications" },
    ]);
  });

  it("shows Applications to operators without app-runtime gating", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === MANAGED_APPLICATIONS);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBe(true);
    expect(item?.managedAppKey).toBeUndefined();

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

    expect(operatorWeb.some((i) => i.to === MANAGED_APPLICATIONS)).toBe(true);
    expect(memberWeb.some((i) => i.to === MANAGED_APPLICATIONS)).toBe(false);
  });

  it("places Activity in Spaces settings for operators on web and desktop", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === ACTIVITY);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBe(true);
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
    expect(memberWeb.some((i) => i.to === ACTIVITY)).toBe(false);
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
