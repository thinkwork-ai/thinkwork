import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, RefreshCw } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Button,
  SidebarTrigger,
  ToggleGroup,
  ToggleGroupItem,
  useSidebar,
} from "@thinkwork/ui";
import { usePageHeader } from "@/context/PageHeaderContext";
import { DesktopUpdateBadge } from "@/components/update-banner";
import {
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";

export function DesktopNavigationControls({
  className,
  onBackFallback,
}: {
  className?: string;
  onBackFallback?: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshFallbackRef = useRef<number | null>(null);

  useEffect(() => {
    function stopRefreshing() {
      setRefreshing(false);
      if (refreshFallbackRef.current !== null) {
        window.clearTimeout(refreshFallbackRef.current);
        refreshFallbackRef.current = null;
      }
    }

    window.addEventListener(
      "thinkwork:desktop-refresh-complete",
      stopRefreshing,
    );
    return () => {
      window.removeEventListener(
        "thinkwork:desktop-refresh-complete",
        stopRefreshing,
      );
      stopRefreshing();
    };
  }, []);

  const handleHistoryBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    onBackFallback?.();
  };
  const handleRefresh = () => {
    setRefreshing(true);
    if (refreshFallbackRef.current !== null) {
      window.clearTimeout(refreshFallbackRef.current);
    }

    const handled = !window.dispatchEvent(
      new CustomEvent("thinkwork:desktop-refresh", { cancelable: true }),
    );
    refreshFallbackRef.current = window.setTimeout(
      () => {
        setRefreshing(false);
        refreshFallbackRef.current = null;
      },
      handled ? 10_000 : 600,
    );
  };

  return (
    <div
      className={`flex min-w-0 items-center ${desktopToolbarGapClassName} text-sidebar-foreground ${className ?? ""}`}
    >
      <SidebarTrigger className={`size-8 ${desktopToolbarButtonClassName}`} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={`size-8 ${desktopToolbarButtonClassName}`}
        aria-label="Refresh thread"
        title="Refresh thread"
        aria-busy={refreshing ? "true" : undefined}
        onClick={handleRefresh}
      >
        <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        <span className="sr-only">Refresh thread</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={`size-8 ${desktopToolbarButtonClassName}`}
        onClick={handleHistoryBack}
      >
        <ArrowLeft className="size-4" />
        <span className="sr-only">Back</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={`size-8 ${desktopToolbarButtonClassName}`}
        onClick={() => window.history.forward()}
      >
        <ArrowRight className="size-4" />
        <span className="sr-only">Forward</span>
      </Button>
      <DesktopUpdateBadge className="ml-auto" />
    </div>
  );
}

export function DesktopApplicationHeader() {
  const { actions } = usePageHeader();
  const { open } = useSidebar();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const headerActions = actions?.hideTopBar ? null : actions;
  const tabs = headerActions?.tabs ?? [];
  const hasContent = Boolean(headerActions || tabs.length > 0);
  const activeTab =
    [...tabs]
      .reverse()
      .find((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))
      ?.to ?? "";

  if (open && !hasContent) {
    return (
      <div
        aria-hidden="true"
        className="desktop-app-header pointer-events-auto absolute left-0 right-0 top-0 z-10 h-[var(--desktop-app-header-height)] bg-transparent"
        data-testid="desktop-hidden-drag-region"
      />
    );
  }

  return (
    <header
      className={`desktop-app-header flex h-11 shrink-0 items-center gap-2 pr-3 text-foreground ${open ? "bg-background pl-3" : "bg-background/95 pl-20"}`}
    >
      {open ? null : (
        <DesktopNavigationControls
          className="shrink-0"
          onBackFallback={() => {
            if (headerActions?.backHref) {
              void navigate({ to: headerActions.backHref });
            }
          }}
        />
      )}
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 ${headerActions || tabs.length > 0 ? "" : "pointer-events-none"}`}
      >
        {headerActions ? (
          <div className="flex min-w-0 items-center gap-1">
            {headerActions.breadcrumbs &&
            headerActions.breadcrumbs.length > 0 ? (
              <nav
                aria-label="Breadcrumb"
                className="flex min-w-0 items-center gap-1 overflow-hidden text-sm font-medium"
              >
                {headerActions.breadcrumbs.map((crumb, index) => {
                  const isLast = index === headerActions.breadcrumbs!.length - 1;
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
                          className="shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {crumb.label}
                        </Link>
                      )}
                    </span>
                  );
                })}
              </nav>
            ) : (
              <h1 className="truncate text-sm font-medium">
                {headerActions.title}
              </h1>
            )}
            {headerActions.titleTrailing ? (
              <div className="flex shrink-0 items-center">
                {headerActions.titleTrailing}
              </div>
            ) : null}
            {headerActions.subtitle ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {headerActions.subtitle}
              </span>
            ) : null}
          </div>
        ) : null}

        {tabs.length > 0 ? (
          <div className="flex flex-1 justify-center">
            <ToggleGroup type="single" value={activeTab} variant="outline">
              {tabs.map((tab) => (
                <ToggleGroupItem
                  key={tab.to}
                  value={tab.to}
                  asChild
                  className="px-3 text-xs"
                >
                  <Link to={tab.to}>{tab.label}</Link>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        <div
          className={`ml-auto flex shrink-0 items-center ${desktopToolbarGapClassName}`}
        >
          {headerActions?.action ? headerActions.action : null}
        </div>
      </div>
    </header>
  );
}
