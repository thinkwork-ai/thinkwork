import { Fragment } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button, Tabs, TabsList, TabsTrigger, useSidebar } from "@thinkwork/ui";
import { usePageHeader } from "@/context/PageHeaderContext";

export function AppTopBar() {
  const { actions } = usePageHeader();
  // On narrow screens a floating hamburger (rendered by the shell) sits at the
  // top-left, so pad the header content past it to avoid overlap.
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (actions?.hideTopBar) return null;

  // Highlight the deepest tab whose href is a prefix of pathname so e.g.
  // /memory/kbs/$kbId still flags "KBs" as active.
  const tabs = actions?.tabs ?? [];
  const activeTab =
    [...tabs]
      .reverse()
      .find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ??
    "";
  const handleHistoryBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    if (actions?.backHref) {
      void navigate({ to: actions.backHref });
    }
  };

  return (
    <header
      className={`flex h-12 shrink-0 items-center gap-2 border-b border-border pr-4 ${isMobile ? "pl-14" : "pl-4"}`}
    >
      {actions ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {actions.backHref ? (
            actions.backBehavior === "history" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={handleHistoryBack}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back</span>
              </Button>
            ) : (
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
              >
                <Link to={actions.backHref}>
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">Back</span>
                </Link>
              </Button>
            )
          ) : null}
          {actions.breadcrumbs && actions.breadcrumbs.length > 0 ? (
            <nav
              aria-label="Breadcrumb"
              // Grow to fill the bar only while an inline title editor is
              // active (titleContent present, the "…" titleTrailing hidden),
              // so the rename input spans the full width. When not editing,
              // stay content-sized so the "…" menu hugs the title.
              className={`flex min-w-0 items-center overflow-hidden text-sm font-medium${
                actions.titleContent && !actions.titleTrailing ? " flex-1" : ""
              }`}
            >
              {actions.breadcrumbs.map((crumb, index) => {
                const isLast = index === actions.breadcrumbs!.length - 1;
                return (
                  <Fragment
                    key={`${crumb.href ?? "current"}:${crumb.label}:${index}`}
                  >
                    {index > 0 ? (
                      <ChevronRight
                        className="mx-1.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={`flex ${
                        isLast ? "min-w-0" : "shrink-0"
                      } items-center${
                        isLast && actions.titleContent ? " flex-1" : ""
                      }`}
                    >
                      {isLast && actions.titleContent ? (
                        <div className="min-w-0 flex-1">
                          {actions.titleContent}
                        </div>
                      ) : isLast || !crumb.href ? (
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
                  </Fragment>
                );
              })}
            </nav>
          ) : actions.titleContent ? (
            <div className="min-w-0">{actions.titleContent}</div>
          ) : (
            <h1 className="truncate text-sm font-medium">{actions.title}</h1>
          )}
          {actions.titleTrailing ? (
            <div className="flex shrink-0 items-center">
              {actions.titleTrailing}
            </div>
          ) : null}
          {actions.subtitle ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {actions.subtitle}
            </span>
          ) : null}
        </div>
      ) : null}

      {tabs.length > 0 ? (
        <div className="flex flex-1 justify-center">
          <Tabs value={activeTab}>
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.to}
                  value={tab.to}
                  asChild
                  className="px-3"
                >
                  <Link to={tab.to}>{tab.label}</Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {actions?.action ? (
          <div className="flex shrink-0 items-center">{actions.action}</div>
        ) : null}
      </div>
    </header>
  );
}
