import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, cn } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { SettingsDeploymentStatusQuery } from "@/lib/settings-queries";
import {
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";
import { getSettingsReturnTo } from "@/lib/settings-return";
import { visibleSettingsNavItems } from "@/components/settings/settings-nav";

// Matches the main chat-sidebar nav item style (SidebarMenuButton): h-8, p-2,
// gap-2, text-sm, size-4 icons.
const itemClassName =
  "flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm text-sidebar-foreground/85 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-4 [&_svg]:shrink-0";

export function SettingsSidebar({
  onNavigate,
  forceWebChrome = false,
}: {
  /** Called when a nav target is chosen — lets the mobile Sheet close itself. */
  onNavigate?: () => void;
  /**
   * Force the web-style brand header even on desktop. Used when the sidebar is
   * rendered inside a Sheet overlay, where the OS traffic-light band and drag
   * strip don't apply.
   */
  forceWebChrome?: boolean;
} = {}) {
  const navigate = useNavigate();
  const { isOperator, roleResolved } = useTenant();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isDesktop = isDesktopBuild();
  const showDesktopChrome = isDesktop && !forceWebChrome;
  const showOperator = roleResolved && isOperator;
  const [deploymentResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
  });
  const deployment = deploymentResult.data?.deploymentStatus;
  const managedApplications = {
    cognee:
      deployment?.managedApplications.find((app) => app.key === "cognee")
        ?.runtimeEnabled ??
      deployment?.cogneeEnabled ??
      false,
    twenty:
      deployment?.managedApplications.find((app) => app.key === "twenty")
        ?.runtimeEnabled ??
      deployment?.twentyRuntimeEnabled ??
      false,
  };

  // Hide operator items until the role is known, to avoid a flash of operator
  // content for members.
  const items = visibleSettingsNavItems({
    isOperator,
    roleResolved,
    isDesktop,
    managedApplications,
  });

  return (
    <aside
      className={cn(
        "tw-vibrancy-panel flex h-svh flex-col border-r border-sidebar-border bg-sidebar",
        // Docked: fixed-width column. In the Sheet overlay: fill the sheet.
        forceWebChrome ? "w-full" : "w-72 shrink-0",
      )}
    >
      {/* Web carries the brand header from the chat shell; desktop relies on
          its own window chrome. Padding mirrors the shell SidebarHeader
          (p-2 + pb-3, inner brand px-1) so the logo aligns across surfaces. */}
      {showDesktopChrome ? (
        // Reserve the macOS traffic-light band (mirrors SpacesSidebar's top
        // strip: same height, pl-20, draggable) and carry the back/forward
        // history controls here, next to the lights — mirroring the main nav.
        <div
          className={cn(
            "desktop-app-header flex h-[var(--desktop-app-header-height)] shrink-0 items-center pl-20 pr-3 text-sidebar-foreground/70",
            desktopToolbarGapClassName,
          )}
        >
          <SettingsNavControls
            onBackFallback={() => navigate({ to: getSettingsReturnTo() })}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 pt-2 pb-3">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <img
              src="/logo.png"
              alt="ThinkWork"
              className="h-7 w-7 shrink-0 object-contain"
            />
            <span className="truncate text-base font-semibold leading-none tracking-tight">
              ThinkWork
            </span>
          </Link>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-0">
        <button
          type="button"
          className={cn(itemClassName, "mb-2 text-sidebar-foreground/65")}
          onClick={() => {
            onNavigate?.();
            navigate({ to: getSettingsReturnTo() });
          }}
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
                onClick={() => onNavigate?.()}
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

/** Back / forward history controls for the desktop sidebar strip. */
function SettingsNavControls({
  onBackFallback,
}: {
  onBackFallback: () => void;
}) {
  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    onBackFallback();
  };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("size-8", desktopToolbarButtonClassName)}
        aria-label="Back"
        title="Back"
        onClick={handleBack}
      >
        <ArrowLeft className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn("size-8", desktopToolbarButtonClassName)}
        aria-label="Forward"
        title="Forward"
        onClick={() => window.history.forward()}
      >
        <ArrowRight className="size-4" />
      </Button>
    </>
  );
}
