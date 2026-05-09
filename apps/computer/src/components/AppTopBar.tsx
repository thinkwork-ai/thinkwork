import { ArrowLeft, Moon, Sun } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button, UserMenu, useTheme } from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { usePageHeader } from "@/context/PageHeaderContext";

export function AppTopBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { actions } = usePageHeader();
  const next = theme === "dark" ? "light" : "dark";

  if (actions?.hideTopBar) return null;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      {actions ? (
        <div className="flex min-w-0 items-center gap-2">
          {actions.backHref ? (
            <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
              <Link to={actions.backHref}>
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back</span>
              </Link>
            </Button>
          ) : null}
          <h1 className="truncate text-sm font-medium">{actions.title}</h1>
          {actions.subtitle ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {actions.subtitle}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
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
