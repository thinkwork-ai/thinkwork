import type { ComponentType } from "react";
import {
  Bot,
  Brain,
  FileBox,
  Cpu,
  History,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import {
  IconBrandStackshare,
  IconFlask,
  IconPlanet,
} from "@tabler/icons-react";
import { ModelContextProtocol } from "../icons/ModelContextProtocol";

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
    icon: IconFlask,
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
  // Renamed to "Connectors" (THINK-285): the section carries the per-user
  // Connections tab (OAuth integrations), the merged MCP Servers tab, and the
  // Data Sources tab.
  {
    label: "Connectors",
    to: "/settings/mcp-servers",
    icon: ModelContextProtocol,
  },
  {
    label: "Model Catalog",
    to: "/settings/model-catalog",
    icon: Cpu,
    operatorOnly: true,
  },
  {
    label: "Activity",
    to: "/settings/activity",
    icon: History,
  },
  // Living Artifacts (THINK-145): canvases are saved/versioned artifacts now —
  // the operator list surface returns to the nav. Gating matches the parent
  // layout route (settings.artifacts.tsx), which is operator-only.
  {
    label: "Artifacts",
    to: "/settings/artifacts",
    icon: FileBox,
    operatorOnly: true,
  },
  // "Knowledge" is the user-facing umbrella for the memory/pages/KBs
  // surfaces (Company Brain U9 naming decision — never "Company Brain" in UI).
  {
    label: "Knowledge",
    to: "/settings/memory",
    icon: Brain,
    operatorOnly: true,
  },
  // Automations and Routines collapsed into the unified Workflows section
  // (THINK-218): Automations/Routines/Agent Loops surfaces all redirect to
  // /settings/workflows now — Routines lives on as the Library tab.
  {
    label: "Workflows",
    to: "/settings/workflows",
    icon: IconBrandStackshare,
    operatorOnly: true,
  },
  // THINK-137 U8 (R8): Webhooks retired from the nav. Every webhook is now an
  // Automation with a `webhook` trigger, managed under Automations. The
  // `/settings/webhooks*` routes remain as redirects for old links.
  // Agent page (THINK-132 U7): the single agent-configuration surface — the
  // Composer merged in.
  {
    label: "Agents",
    to: "/settings/agents",
    icon: Bot,
    operatorOnly: true,
  },
];

// Strictly alphabetised by label (Eric 2026-07-22 — General is no longer
// pinned) so the growing operator list stays scannable. Sorting at export
// keeps the source list above free-form — new items can be added in any
// order.
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  ...RAW_SETTINGS_NAV_ITEMS,
].sort((a, b) => a.label.localeCompare(b.label));

/**
 * Visible settings sections for the current caller. Operator-only sections need
 * a resolved operator role. Pure so it can be unit-tested without rendering the
 * sidebar.
 */
export function visibleSettingsNavItems(opts: {
  isOperator: boolean;
  roleResolved: boolean;
}): SettingsNavItem[] {
  return SETTINGS_NAV_ITEMS.filter(
    (item) => !item.operatorOnly || (opts.roleResolved && opts.isOperator),
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
