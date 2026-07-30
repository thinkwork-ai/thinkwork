import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { getSettingsReturnTo } from "@/lib/settings-return";
import { visibleSettingsNavItems } from "@/components/settings/settings-nav";

// Matches the main chat-sidebar nav item style (SidebarMenuButton): h-8, p-2,
// gap-2, text-sm, size-4 icons.
const itemClassName =
  "flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground/85 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-4 [&_svg]:shrink-0";

export function SettingsSidebar({
  onNavigate,
  inSheet = false,
}: {
  /** Called when a nav target is chosen — lets the mobile Sheet close itself. */
  onNavigate?: () => void;
  /** True when rendered inside the narrow-screen Sheet overlay (fills it). */
  inSheet?: boolean;
} = {}) {
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Hide operator items until the role is known, to avoid a flash of operator
  // content for members.
  const items = visibleSettingsNavItems({ isOperator, roleResolved });

  return (
    <aside
      className={cn(
        "flex h-svh flex-col border-r border-sidebar-border bg-sidebar",
        // Docked: fixed-width column. In the Sheet overlay: fill the sheet.
        inSheet ? "w-full" : "w-72 shrink-0",
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-2 pb-3">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <img
            src="/logo.png"
            alt="ThinkWork Harness"
            className="h-7 w-7 shrink-0 object-contain"
          />
          <span className="truncate text-base font-semibold leading-none tracking-tight">
            ThinkWork Harness
          </span>
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col pb-2 pt-0">
        {/* Horizontal padding lives on the inner content, not on the scroll
            container, so the scrollbar rides the panel's right edge (matching
            the main nav) instead of being inset by the padding. */}
        <div className="shrink-0 px-3">
          <button
            type="button"
            // shrink-0 so the row keeps its h-8 even when the nav below overflows
            // — otherwise flexbox compresses it and "Back to app" drifts off the
            // "New thread" line, shifting content when switching Settings <-> Main.
            className={cn(
              itemClassName,
              "mb-2 shrink-0 text-sidebar-foreground/65",
            )}
            onClick={() => {
              onNavigate?.();
              navigate({ to: getSettingsReturnTo() });
            }}
          >
            <ArrowLeft />
            <span>Back to app</span>
          </button>
        </div>
        {/* Full-width block scroll container so the scrollbar sits outboard at
            the panel edge. Block (not flex) flow keeps each item at its natural
            h-8 and overflows into a scroll rather than flex-shrinking to fit. */}
        <nav
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          aria-label="Settings sections"
        >
          <div className="space-y-0.5 px-3">
            {items.map((item) => {
              const active = pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => onNavigate?.()}
                  className={cn(
                    itemClassName,
                    "shrink-0",
                    active &&
                      "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </aside>
  );
}
