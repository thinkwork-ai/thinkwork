import { ArrowLeft, ArrowRight } from "lucide-react";
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

export function DesktopNavigationControls({
  className,
  onBackFallback,
}: {
  className?: string;
  onBackFallback?: () => void;
}) {
  const handleHistoryBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    onBackFallback?.();
  };

  return (
    <div
      className={`flex min-w-0 items-center gap-1 text-sidebar-foreground ${className ?? ""}`}
    >
      <SidebarTrigger className="size-8 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        onClick={handleHistoryBack}
      >
        <ArrowLeft className="size-4" />
        <span className="sr-only">Back</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-8 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
    return null;
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
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-medium">
              {headerActions.title}
            </h1>
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

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {headerActions?.action ? headerActions.action : null}
        </div>
      </div>
    </header>
  );
}
