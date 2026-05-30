import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_ITEMS,
  visibleSettingsNavItems,
} from "./settings-nav";

const LOCAL_WORKSPACE = "/settings/local-workspace";

describe("visibleSettingsNavItems", () => {
  it("declares Local Workspace as a desktop-only, non-operator section", () => {
    const item = SETTINGS_NAV_ITEMS.find((i) => i.to === LOCAL_WORKSPACE);
    expect(item).toBeDefined();
    expect(item?.desktopOnly).toBe(true);
    expect(item?.operatorOnly).toBeFalsy();
  });

  it("shows Local Workspace on desktop builds (AE3)", () => {
    const items = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: true,
    });
    expect(items.some((i) => i.to === LOCAL_WORKSPACE)).toBe(true);
  });

  it("hides Local Workspace on the web build (AE3)", () => {
    const items = visibleSettingsNavItems({
      isOperator: true,
      roleResolved: true,
      isDesktop: false,
    });
    expect(items.some((i) => i.to === LOCAL_WORKSPACE)).toBe(false);
  });

  it("still gates operator-only sections independently of desktop", () => {
    const memberDesktop = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: true,
    });
    // An operator-only section (Agent) stays hidden for a non-operator even on
    // desktop, while the desktop-only Local Workspace shows.
    expect(memberDesktop.some((i) => i.to === "/settings/agent")).toBe(false);
    expect(memberDesktop.some((i) => i.to === LOCAL_WORKSPACE)).toBe(true);
  });
});
