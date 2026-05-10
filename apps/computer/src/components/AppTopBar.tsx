import { ArrowLeft, Moon, Sun } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Button,
  ToggleGroup,
  ToggleGroupItem,
  UserMenu,
  useTheme,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { usePageHeader } from "@/context/PageHeaderContext";

export function AppTopBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { actions } = usePageHeader();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const next = theme === "dark" ? "light" : "dark";

  if (actions?.hideTopBar) return null;

  // Highlight the deepest tab whose href is a prefix of pathname so e.g.
  // /memory/kbs/$kbId still flags "KBs" as active.
  const tabs = actions?.tabs ?? [];
  const activeTab =
    [...tabs]
      .reverse()
      .find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ?? "";
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
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-4 pr-4">
      {actions ? (
        <div className="flex min-w-0 items-center gap-2">
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
              <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
                <Link to={actions.backHref}>
                  <ArrowLeft className="h-4 w-4" />
                  <span className="sr-only">Back</span>
                </Link>
              </Button>
            )
          ) : null}
          <h1 className="truncate text-sm font-medium">{actions.title}</h1>
          {actions.subtitle ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {actions.subtitle}
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

      <div className="ml-auto flex items-center gap-1">
        {actions?.action ? (
          <div className="flex shrink-0 items-center">{actions.action}</div>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Switch to ${next} mode`}
          title={`Switch to ${next} mode`}
          onClick={toggleTheme}
          className="text-muted-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {user ? (
          <UserMenu name={user.name} email={user.email} onSignOut={signOut} />
        ) : null}
      </div>
    </header>
  );
}
