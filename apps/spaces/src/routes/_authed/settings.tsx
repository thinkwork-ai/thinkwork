import { Outlet, createFileRoute } from "@tanstack/react-router";
import { cn } from "@thinkwork/ui";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { SettingsHeaderBar } from "@/components/settings/SettingsHeaderBar";
import { isDesktopBuild } from "@/lib/desktop-runtime";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsLayout,
});

// Full-screen takeover: settings lives outside the chat _shell, so the chat
// sidebar + top bar are not rendered here. The dedicated SettingsSidebar is
// the left column; section content renders in the right pane below a header
// bar that carries the section title as a breadcrumb (relocated out of the
// content body) plus back/forward navigation.
//
// On desktop we mirror the main shell's window chrome: `desktop-shell` defines
// --desktop-app-header-height and the OS drag region, the SettingsHeaderBar is
// the draggable strip over the content pane, and the SettingsSidebar reserves
// the macOS traffic-light band to its left.
function SettingsLayout() {
  const isDesktop = isDesktopBuild();
  return (
    <div
      className={cn(
        "flex h-svh min-h-0 w-full overflow-hidden bg-background",
        isDesktop && "desktop-shell",
      )}
    >
      <SettingsSidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SettingsHeaderBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
