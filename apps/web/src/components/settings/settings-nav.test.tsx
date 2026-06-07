import { describe, expect, it } from "vitest";
import {
  SETTINGS_NAV_ITEMS,
  settingsCrumbForPath,
  visibleSettingsNavItems,
} from "./settings-nav";

const labels = () => SETTINGS_NAV_ITEMS.map((item) => item.label);
const paths = () => SETTINGS_NAV_ITEMS.map((item) => item.to);

describe("settings-nav", () => {
  // U1: Managed Applications renamed to Applications
  it("exposes an 'Applications' item and no 'Managed Applications' item", () => {
    expect(labels()).toContain("Applications");
    expect(labels()).not.toContain("Managed Applications");
  });

  it("keeps the Applications route path stable at /settings/managed-applications", () => {
    const applications = SETTINGS_NAV_ITEMS.find(
      (item) => item.label === "Applications",
    );
    expect(applications?.to).toBe("/settings/managed-applications");
  });

  it("derives the Applications breadcrumb from the renamed nav label", () => {
    expect(settingsCrumbForPath("/settings/managed-applications")).toEqual([
      { label: "Applications" },
    ]);
  });

  // U4: standalone CRM nav entry removed (reachable via Applications drill-in)
  it("does not list a standalone CRM nav entry", () => {
    expect(paths()).not.toContain("/settings/crm");
    expect(labels()).not.toContain("CRM");
  });

  it("filters operator-only items for non-operators", () => {
    const visible = visibleSettingsNavItems({
      isOperator: false,
      roleResolved: true,
      isDesktop: false,
    });
    // General is the only non-operator item.
    expect(visible.every((item) => !item.operatorOnly)).toBe(true);
    expect(visible.map((item) => item.label)).toContain("General");
  });
});
