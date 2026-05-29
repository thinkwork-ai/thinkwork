import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bot,
  LayoutGrid,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { getSettingsReturnTo } from "@/lib/settings-return";

interface SettingsNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** When true, only render for operators (owner/admin). */
  operatorOnly?: boolean;
}

// General first (visible to all), then operator-only sections. Appearance is
// folded into General as a "Color mode" control rather than a nav item.
const NAV_ITEMS: SettingsNavItem[] = [
  { label: "General", to: "/settings/general", icon: SettingsIcon },
  {
    label: "Spaces",
    to: "/settings/spaces",
    icon: LayoutGrid,
    operatorOnly: true,
  },
  { label: "Users", to: "/settings/users", icon: Users, operatorOnly: true },
  { label: "Agent", to: "/settings/agent", icon: Bot, operatorOnly: true },
];

// Matches the main chat-sidebar nav item style (SidebarMenuButton): h-8, p-2,
// gap-2, text-sm, size-4 icons.
const itemClassName =
  "flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground/85 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-4 [&_svg]:shrink-0";

export function SettingsSidebar() {
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDesktop = isDesktopBuild();

  // Hide operator items until the role is known, to avoid a flash of operator
  // content for members.
  const items = NAV_ITEMS.filter(
    (item) => !item.operatorOnly || (roleResolved && isOperator),
  );

  return (
    <aside className="flex h-svh w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Web carries the brand header from the chat shell; desktop relies on
          its own window chrome. Padding mirrors the shell SidebarHeader
          (p-2 + pb-3, inner brand px-1) so the logo aligns across surfaces. */}
      {isDesktop ? null : (
        <div className="flex items-center gap-2 px-3 pt-2 pb-3">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <img
              src="/logo.png"
              alt="ThinkWork"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-base font-semibold leading-none tracking-tight">
                ThinkWork
              </span>
              <span className="truncate text-xs text-sidebar-foreground/55">
                Spaces
              </span>
            </div>
          </Link>
        </div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-3 pb-2",
          isDesktop && "pt-2",
        )}
      >
        <button
          type="button"
          className={cn(itemClassName, "mb-2 text-sidebar-foreground/65")}
          onClick={() => navigate({ to: getSettingsReturnTo() })}
        >
          <ArrowLeft />
          <span>Back to app</span>
        </button>
        <nav className="flex flex-col gap-0.5" aria-label="Settings sections">
          {items.map((item) => {
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  itemClassName,
                  active &&
                    "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <item.icon />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
