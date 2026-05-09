import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Moon, Search, Sun } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { AppSidebar } from "@/components/Sidebar";
import { BreadcrumbBar } from "@/components/BreadcrumbBar";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@thinkwork/ui";
import { CommandPalette } from "@/components/CommandPalette";
import { AppSyncSubscriptionProvider } from "@/context/AppSyncSubscriptionProvider";
import { CreateThreadDialog } from "@/components/threads/CreateThreadDialog";
import { NewAgentDialog } from "@/components/agents/NewAgentDialog";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export const Route = createFileRoute("/_authed/_tenant")({
  component: TenantLayout,
});

function TenantLayout() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "light" : "dark";

  function openSearch() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true }),
    );
  }

  return (
    <AppSyncSubscriptionProvider>
      <CommandPalette />
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 h-svh flex flex-col">
          {/* Top bar */}
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
            <BreadcrumbBar />

            {/* Right side actions */}
            <div className="flex items-center gap-1 shrink-0 ml-auto">
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                onClick={openSearch}
              >
                <Search className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground"
                onClick={toggleTheme}
                aria-label={`Switch to ${nextTheme} mode`}
                title={`Switch to ${nextTheme} mode`}
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
              <UserMenu
                name={user?.name}
                email={user?.email}
                onSignOut={signOut}
              />
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 min-h-0 min-w-0">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CreateThreadDialog />
      <NewAgentDialog />
    </AppSyncSubscriptionProvider>
  );
}
