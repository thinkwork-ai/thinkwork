import { Moon, Sun } from "lucide-react";
import { Button, SidebarTrigger, useTheme } from "@thinkwork/ui";

export function AppTopBar() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <SidebarTrigger className="-ml-1" />
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
      </div>
    </header>
  );
}
