import type { ComponentType } from "react";
import {
  AppWindow,
  Bot,
  Brain,
  Clock,
  Cpu,
  History,
  Repeat,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
  Wrench,
} from "lucide-react";
import { IconApps, IconPlanet, IconPlug } from "@tabler/icons-react";
import { ModelContextProtocol } from "../icons/ModelContextProtocol";

export interface SettingsNavItem {
  label: string;
  to: string;
  // Accepts both lucide-react and @tabler/icons-react components.
  icon: ComponentType<{ className?: string }>;
  /** When true, only render for operators (owner/admin). */
  operatorOnly?: boolean;
  /** When true, only render in the desktop build (needs the local bridge). */
  desktopOnly?: boolean;
  /**
   * Optional managed app that must be runtime-enabled before the item shows.
   * Cognee-only since the U10 Twenty plugin migration: Twenty's surfaces
   * (plugin detail + /settings/crm) gate on plugin/deployment state, not on
   * a nav-level managed-app guard.
   */
  managedAppKey?: "cognee";
}

// General first (visible to all), then operator-only sections. Appearance is
// folded into General as a "Color mode" control rather than a nav item.
const RAW_SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { label: "General", to: "/settings/general", icon: SettingsIcon },
  {
    label: "Spaces",
    to: "/settings/spaces",
    icon: IconPlanet,
    operatorOnly: true,
  },
  { label: "Users", to: "/settings/users", icon: Users, operatorOnly: true },
  {
    label: "Evaluations",
    to: "/settings/evaluations",
    icon: ShieldCheck,
    operatorOnly: true,
  },
  {
    label: "Skill Library",
    to: "/settings/skills",
    icon: Sparkles,
    operatorOnly: true,
  },
  {
    label: "Tool Library",
    to: "/settings/tools",
    icon: Wrench,
    operatorOnly: true,
  },
  {
    label: "MCP Servers",
    to: "/settings/mcp-servers",
    icon: ModelContextProtocol,
    operatorOnly: true,
  },
  {
    label: "Model Catalog",
    to: "/settings/model-catalog",
    icon: Cpu,
    operatorOnly: true,
  },
  {
    label: "Applications",
    to: "/settings/managed-applications",
    icon: IconApps,
    operatorOnly: true,
  },
  // Plugins is deliberately NOT operatorOnly (plan 2026-06-12-001 U8): all
  // members can browse and connect; install/update/uninstall gate at render
  // time inside the pages.
  {
    label: "Plugins",
    to: "/settings/plugins",
    icon: IconPlug,
  },
  {
    label: "Activity",
    to: "/settings/activity",
    icon: History,
    operatorOnly: true,
  },
  {
    label: "Artifacts",
    to: "/settings/artifacts",
    icon: AppWindow,
    operatorOnly: true,
  },
  { label: "Memory", to: "/settings/memory", icon: Brain, operatorOnly: true },
  {
    label: "Automations",
    to: "/settings/automations",
    icon: Clock,
    operatorOnly: true,
  },
  {
    label: "Routines",
    to: "/settings/routines",
    icon: Repeat,
    operatorOnly: true,
  },
  {
    label: "Webhooks",
    to: "/settings/webhooks",
    icon: Webhook,
    operatorOnly: true,
  },
  {
    label: "Agents",
    to: "/settings/agents",
    icon: Bot,
    operatorOnly: true,
  },
];

// "General" stays pinned at the top; the remaining sections are alphabetised by
// label so the growing operator list stays scannable. Sorting at export keeps
// the source list above free-form — new items can be added in any order.
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  ...RAW_SETTINGS_NAV_ITEMS.filter((item) => item.label === "General"),
  ...RAW_SETTINGS_NAV_ITEMS.filter((item) => item.label !== "General").sort(
    (a, b) => a.label.localeCompare(b.label),
  ),
];

/**
 * Visible settings sections for the current caller. Operator-only sections need
 * a resolved operator role; desktop-only sections need the desktop bridge
 * build. Pure so it can be unit-tested without rendering the sidebar.
 */
export function visibleSettingsNavItems(opts: {
  isOperator: boolean;
  roleResolved: boolean;
  isDesktop: boolean;
  managedApplications?: Partial<Record<"cognee", boolean>>;
}): SettingsNavItem[] {
  return SETTINGS_NAV_ITEMS.filter(
    (item) =>
      (!item.operatorOnly || (opts.roleResolved && opts.isOperator)) &&
      (!item.desktopOnly || opts.isDesktop) &&
      (!item.managedAppKey ||
        opts.managedApplications?.[item.managedAppKey] === true),
  );
}

export interface SettingsCrumb {
  label: string;
  href?: string;
  search?: Record<string, unknown>;
}

/**
 * Fallback breadcrumb for a settings path when the active route hasn't
 * published its own (list/simple sections). Detail pages publish nested
 * breadcrumbs via `usePageHeaderActions` and override this. Returns the
 * single matching nav-section label (no href — it's the current page).
 */
export function settingsCrumbForPath(pathname: string): SettingsCrumb[] {
  const match = [...SETTINGS_NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  return [{ label: match?.label ?? "Settings" }];
}
