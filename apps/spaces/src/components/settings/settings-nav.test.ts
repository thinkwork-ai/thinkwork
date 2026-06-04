import { describe, expect, it } from "vitest";
import { SETTINGS_NAV_ITEMS, visibleSettingsNavItems } from "./settings-nav";

const LOCAL_WORKSPACE = "/settings/local-workspace";
const KNOWLEDGE_GRAPH = "/settings/knowledge-graph";

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

  it("places Knowledge Graph in Spaces settings for operators on web and desktop", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === KNOWLEDGE_GRAPH);
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

    expect(operatorWeb.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(true);
    expect(operatorDesktop.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(true);
    expect(memberWeb.some((i) => i.to === KNOWLEDGE_GRAPH)).toBe(false);
  });
});
