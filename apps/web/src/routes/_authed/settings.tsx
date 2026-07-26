import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { Menu } from "lucide-react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  cn,
  useIsMobile,
} from "@thinkwork/ui";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { SettingsHeaderBar } from "@/components/settings/SettingsHeaderBar";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsLayout,
});

// Full-screen takeover: settings lives outside the chat _shell, so the chat
// sidebar + top bar are not rendered here. The dedicated SettingsSidebar is
// the left column; section content renders in the right pane below a header
// bar that carries the section title as a breadcrumb (relocated out of the
// content body) plus back/forward navigation.
function SettingsLayout() {
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="relative flex h-svh min-h-0 w-full overflow-hidden bg-background">
      {/* Wide screens dock the nav; narrow screens collapse it into a left
          Sheet opened by the floating trigger below (mirrors the main shell). */}
      {isMobile ? (
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open settings navigation"
              className="absolute top-2 left-2 z-50 size-8 bg-background/70 backdrop-blur hover:bg-accent"
            >
              <Menu className="size-4" />
              <span className="sr-only">Open settings navigation</span>
            </Button>
          </SheetTrigger>
          {/* Mirror the main shell's mobile sidebar Sheet exactly so the two
              overlays share a width (18rem) and both hide the default close
              button (the nav closes on selection / overlay click). */}
          <SheetContent
            side="left"
            className="w-(--sidebar-width) bg-sidebar p-0 [&>button]:hidden"
            style={{ "--sidebar-width": "18rem" } as CSSProperties}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Settings navigation</SheetTitle>
              <SheetDescription>Browse settings sections.</SheetDescription>
            </SheetHeader>
            <SettingsSidebar inSheet onNavigate={() => setNavOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : (
        <SettingsSidebar />
      )}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <SettingsHeaderBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
