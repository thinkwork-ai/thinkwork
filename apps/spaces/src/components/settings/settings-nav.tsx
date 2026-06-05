import type { ComponentType } from "react";
import {
  AppWindow,
  BookOpen,
  Brain,
  FolderTree,
  NotebookText,
  Repeat,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import {
  IconChartBar,
  IconPlanet,
  IconTopologyStar3,
} from "@tabler/icons-react";
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
}

// General first (visible to all), then operator-only sections. Appearance is
// folded into General as a "Color mode" control rather than a nav item.
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { label: "General", to: "/settings/general", icon: SettingsIcon },
  {
    label: "Spaces",
    to: "/settings/spaces",
    icon: IconPlanet,
    operatorOnly: true,
  },
  { label: "Users", to: "/settings/users", icon: Users, operatorOnly: true },
  {
    label: "Workspace",
    to: "/settings/local-workspace",
    icon: FolderTree,
  },
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
    label: "Built-in Tools",
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
    label: "Artifacts",
    to: "/settings/artifacts",
    icon: AppWindow,
    operatorOnly: true,
  },
  {
    label: "Knowledge Graph",
    to: "/settings/knowledge-graph",
    icon: IconTopologyStar3,
    operatorOnly: true,
  },
  {
    label: "Knowledge Bases",
    to: "/settings/knowledge-bases",
    icon: BookOpen,
    operatorOnly: true,
  },
  { label: "Memory", to: "/settings/memory", icon: Brain, operatorOnly: true },
  {
    label: "Wiki Memory",
    to: "/settings/wiki",
    icon: NotebookText,
    operatorOnly: true,
  },
  {
    label: "Automations",
    to: "/settings/automations",
    icon: Zap,
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
    label: "Analytics",
    to: "/settings/analytics",
    icon: IconChartBar,
    operatorOnly: true,
  },
];

/**
 * Visible settings sections for the current caller. Operator-only sections need
 * a resolved operator role; desktop-only sections (the local-workspace
 * inspector) need the desktop bridge build. Pure so it can be unit-tested
 * without rendering the sidebar.
 */
export function visibleSettingsNavItems(opts: {
  isOperator: boolean;
  roleResolved: boolean;
  isDesktop: boolean;
}): SettingsNavItem[] {
  return SETTINGS_NAV_ITEMS.filter(
    (item) =>
      (!item.operatorOnly || (opts.roleResolved && opts.isOperator)) &&
      (!item.desktopOnly || opts.isDesktop),
  );
}

export interface SettingsCrumb {
  label: string;
  href?: string;
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
