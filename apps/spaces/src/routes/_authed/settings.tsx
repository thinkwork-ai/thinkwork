import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsLayout,
});

// Full-screen takeover: settings lives outside the chat _shell, so the chat
// sidebar + top bar are not rendered here. The dedicated SettingsSidebar is
// the left column; section content renders in the right pane.
function SettingsLayout() {
  return (
    <div className="flex h-svh min-h-0 w-full overflow-hidden bg-background">
      <SettingsSidebar />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
