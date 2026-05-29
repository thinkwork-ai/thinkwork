import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  LayoutGrid,
  Settings as SettingsIcon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { getSettingsReturnTo } from "@/lib/settings-return";

interface SettingsNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** When true, only render for operators (owner/admin). */
  operatorOnly?: boolean;
}

// Order follows the Codex reference: personal first (Appearance), then the
// always-visible General, then operator-only sections.
const NAV_ITEMS: SettingsNavItem[] = [
  { label: "Appearance", to: "/settings/appearance", icon: Sun },
  { label: "General", to: "/settings/general", icon: SettingsIcon },
  {
    label: "Spaces",
    to: "/settings/spaces",
    icon: LayoutGrid,
    operatorOnly: true,
  },
  { label: "Agent", to: "/settings/agent", icon: Bot, operatorOnly: true },
];

const itemClassName =
  "flex h-9 w-full min-w-0 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/85 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export function SettingsSidebar() {
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Hide operator items until the role is known, to avoid a flash of operator
  // content for members.
  const items = NAV_ITEMS.filter(
    (item) => !item.operatorOnly || (roleResolved && isOperator),
  );

  return (
    <aside className="flex h-svh w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4">
      <button
        type="button"
        className="mb-4 flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm text-sidebar-foreground/65 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={() => navigate({ to: getSettingsReturnTo() })}
      >
        <ArrowLeft className="size-4" />
        <span>Back to app</span>
      </button>
      <nav className="space-y-1" aria-label="Settings sections">
        {items.map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                itemClassName,
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
