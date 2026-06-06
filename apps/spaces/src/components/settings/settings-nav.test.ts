import { describe, expect, it } from "vitest";
import { SETTINGS_NAV_ITEMS, visibleSettingsNavItems } from "./settings-nav";

const LOCAL_WORKSPACE = "/settings/local-workspace";
const ACTIVITY = "/settings/activity";
const KNOWLEDGE_GRAPH = "/settings/knowledge-graph";
const KNOWLEDGE_BASES = "/settings/knowledge-bases";
const CRM = "/settings/crm";
const MANAGED_APPLICATIONS = "/settings/managed-applications";

describe("visibleSettingsNavItems", () => {
  it("declares Workspace as a non-operator, non-desktop-gated section", () => {
    // The S3-backed editor works in any build; editing is gated to owner/admin
    // inside the view (readOnly), not by hiding the nav entry.
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === LOCAL_WORKSPACE);
    expect(item).toBeDefined();
    expect(item?.desktopOnly).toBeFalsy();
    expect(item?.operatorOnly).toBeFalsy();
  });

  it("shows Workspace on the web build for any role", () => {
    const items = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });
    expect(items.some((i) => i.to === LOCAL_WORKSPACE)).toBe(true);
  });

  it("shows Workspace on desktop builds too", () => {
    const items = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: true,
    });
    expect(items.some((i) => i.to === LOCAL_WORKSPACE)).toBe(true);
  });

  it("still gates operator-only sections independently of Workspace", () => {
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });
    // An operator-only section (Users) stays hidden for a non-operator, while
    // Workspace shows for everyone.
    expect(memberWeb.some((i) => i.to === "/settings/users")).toBe(false);
    expect(memberWeb.some((i) => i.to === LOCAL_WORKSPACE)).toBe(true);
  });

  it("shows Knowledge Graph only after Cognee is runtime-enabled", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === KNOWLEDGE_GRAPH);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBe(true);
    expect(item?.desktopOnly).toBeFalsy();
    expect(item?.managedAppKey).toBe("cognee");

    const operatorWeb = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: false,
    });
    const operatorWithCognee = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: true,
      managedApplications: { cognee: true },
    });
    const memberWeb = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
      managedApplications: { cognee: true },
    });

    expect(operatorWeb.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(false);
    expect(operatorWithCognee.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(true);
    expect(memberWeb.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(false);
  });

  it("shows CRM only after Twenty CRM runtime is enabled", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === CRM);
    expect(item).toBeDefined();
    expect(item?.operatorOnly).toBe(true);
    expect(item?.managedAppKey).toBe("twenty");

    const operatorWithoutTwenty = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: false,
    });
    const operatorWithTwenty = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: false,
      managedApplications: { twenty: true },
    });

    expect(operatorWithoutTwenty.some((i) => i.to === CRM)).toBe(false);
    expect(operatorWithTwenty.some((i) => i.to === CRM)).toBe(true);
  });

  it("shows Managed Applications to operators without app-runtime gating", () => {
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

  it("pins General first and alphabetises the rest by label", () => {
    // General is the only fixed entry; every other section sorts by label so the
    // growing operator list stays scannable. "Knowledge Bases" therefore sorts
    // above "Knowledge Graph" (B < G).
    expect(SETTINGS_NAV_ITEMS[0]?.to).toBe("/settings/general");

    const rest = SETTINGS_NAV_ITEMS.slice(1).map((i) => i.label);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sorted);

    const graphIndex = SETTINGS_NAV_ITEMS.findIndex(
      (i) => i.to === KNOWLEDGE_GRAPH,
    );
    const basesIndex = SETTINGS_NAV_ITEMS.findIndex(
      (i) => i.to === KNOWLEDGE_BASES,
    );
    expect(basesIndex).toBeGreaterThanOrEqual(0);
    expect(graphIndex).toBeGreaterThanOrEqual(0);
    expect(basesIndex).toBeLessThan(graphIndex);
  });
});
