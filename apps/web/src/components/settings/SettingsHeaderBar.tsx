import { ChevronRight } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn, Tabs, TabsList, TabsTrigger, useIsMobile } from "@thinkwork/ui";
import { usePageHeader } from "@/context/PageHeaderContext";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import {
  settingsCrumbForPath,
  type SettingsCrumb,
} from "@/components/settings/settings-nav";

/**
 * Header bar for the settings takeover. Mirrors the main shell's content
 * header: the page title relocates here as a breadcrumb trail (same font as
 * the thread detail header), with the active section's action slot on the
 * right. Back/forward navigation lives in the SettingsSidebar's top strip
 * (next to the traffic lights), mirroring the main nav. On desktop this is the
 * draggable `desktop-app-header` strip; on web it's a plain bordered bar.
 */
export function SettingsHeaderBar() {
  const isDesktop = isDesktopBuild();
  const isMobile = useIsMobile();
  const { actions } = usePageHeader();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs: SettingsCrumb[] =
    actions?.breadcrumbs && actions.breadcrumbs.length > 0
      ? actions.breadcrumbs
      : settingsCrumbForPath(pathname);

  // Optional in-header tab strip (e.g. the unified Memory page). Highlight the
  // deepest tab whose href prefixes the current path so sub-routes stay active.
  const tabs = actions?.tabs ?? [];
  const activeTab =
    [...tabs]
      .reverse()
      .find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ??
    "";

  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-border text-foreground",
        isDesktop
          ? "desktop-app-header h-[var(--desktop-app-header-height)] bg-background pr-3"
          : "h-12 bg-background pr-4",
        // Clear the floating nav trigger the layout renders at top-left when
        // the docked sidebar is collapsed.
        isMobile ? (isDesktop ? "pl-28" : "pl-14") : "pl-4",
      )}
    >
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm font-medium"
      >
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <span
              key={`${crumb.href ?? "current"}:${crumb.label}:${index}`}
              className="flex min-w-0 items-center gap-1"
            >
              {index > 0 ? (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
              ) : null}
              {isLast || !crumb.href ? (
                <span
                  className={
                    isLast
                      ? "truncate text-foreground"
                      : "shrink-0 truncate text-muted-foreground"
                  }
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.href}
                  search={crumb.search}
                  className="shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
        {actions?.subtitle ? (
          <span className="ml-1 shrink-0 truncate text-xs font-normal text-muted-foreground">
            {actions.subtitle}
          </span>
        ) : null}
      </nav>
      {tabs.length > 0 ? (
        <div className="flex flex-1 justify-center">
          <Tabs value={activeTab}>
            <TabsList variant="line" className="h-8 border-b-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.to}
                  value={tab.to}
                  asChild
                  className="px-3 text-xs"
                >
                  <Link to={tab.to}>{tab.label}</Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}
      {actions?.action ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions.action}
        </div>
      ) : null}
    </header>
  );
}
