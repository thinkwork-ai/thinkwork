import type { ComponentType } from "react";
import {
  BookOpen,
  Bot,
  Brain,
  NotebookText,
  Plug,
  Repeat,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import { IconChartBar, IconPlanet } from "@tabler/icons-react";

export interface SettingsNavItem {
  label: string;
  to: string;
  // Accepts both lucide-react and @tabler/icons-react components.
  icon: ComponentType<{ className?: string }>;
  /** When true, only render for operators (owner/admin). */
  operatorOnly?: boolean;
}

// General first (visible to all), then operator-only sections. Appearance is
// folded into General as a "Color mode" control rather than a nav item.
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { label: "General", to: "/settings/general", icon: SettingsIcon },
  { label: "Agent", to: "/settings/agent", icon: Bot, operatorOnly: true },
  {
    label: "Spaces",
    to: "/settings/spaces",
    icon: IconPlanet,
    operatorOnly: true,
  },
  { label: "Users", to: "/settings/users", icon: Users, operatorOnly: true },
  {
    label: "Skills",
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
    icon: Plug,
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
    label: "Evaluations",
    to: "/settings/evaluations",
    icon: ShieldCheck,
    operatorOnly: true,
  },
  {
    label: "Analytics",
    to: "/settings/analytics",
    icon: IconChartBar,
    operatorOnly: true,
  },
];

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
