import {
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Menu } from "lucide-react";
import {
  Button,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@thinkwork/ui";
import { AppTopBar } from "@/components/AppTopBar";
import { DesktopApplicationHeader } from "@/components/DesktopApplicationHeader";
import { SpacesSidebar } from "@/components/SpacesSidebar";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { NoTenantAssigned } from "@/components/NoTenantAssigned";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { requestDesktopNotificationPermission } from "@/lib/desktop-notifications";

export const Route = createFileRoute("/_authed/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { noTenantAssigned, isLoading } = useTenant();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isDesktop = isDesktopBuild();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DESKTOP_SIDEBAR_WIDTH);

  useEffect(() => {
    void requestDesktopNotificationPermission();
  }, []);

  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    void navigate({
      to: "/sign-in",
      search: { next: pathname },
      replace: true,
    });
  }, [authLoading, isAuthenticated, navigate, pathname]);

  if (authLoading || !isAuthenticated) {
    return <ShellLoadingState />;
  }

  if (noTenantAssigned) {
    return <NoTenantAssigned />;
  }

  if (isLoading) {
    return <ShellLoadingState />;
  }

  const shellChrome = (
    <>
      <SpacesSidebar />
      <SidebarInset className="relative flex h-full min-h-0 min-w-0 flex-col">
        {isDesktop ? <DesktopApplicationHeader /> : <AppTopBar />}
        <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </>
  );

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className={`relative h-svh min-h-0 overflow-hidden ${isDesktop ? "desktop-shell" : ""}`}
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--desktop-sidebar-active-width": sidebarOpen
            ? `${sidebarWidth}px`
            : "0px",
        } as CSSProperties
      }
    >
      <SidebarResizeHandle
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      />
      {/* The desktop header renders its own collapsed-chrome trigger; the web
          build's top bar can be hidden entirely (e.g. /new), so it needs a
          header-independent floating trigger to reopen the nav sheet. */}
      {isDesktop ? null : <MobileSidebarTrigger />}
      <div className="flex h-full min-h-0 w-full">{shellChrome}</div>
    </SidebarProvider>
  );
}

function ShellLoadingState() {
  // Use LoadingShimmer directly (rather than <PageSkeleton/>) because
  // this branch renders before the shell exists — there's no flex
  // parent above it, so h-full collapses and PageSkeleton renders at
  // the top of the page. Force viewport-height sizing here so the
  // shimmer sits in the middle.
  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-background">
      <LoadingShimmer />
    </main>
  );
}

function MobileSidebarTrigger() {
  const { isMobile, openMobile, toggleSidebar } = useSidebar();

  // Only on narrow screens, and hidden while the sheet itself is open.
  if (!isMobile || openMobile) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Open navigation"
      onClick={toggleSidebar}
      className="absolute left-2 top-2 z-50 size-8 bg-background/70 backdrop-blur hover:bg-accent"
    >
      <Menu className="size-4" />
      <span className="sr-only">Open navigation</span>
    </Button>
  );
}

const DESKTOP_SIDEBAR_WIDTH = 300;
const DESKTOP_SIDEBAR_MIN_WIDTH = 240;
const DESKTOP_SIDEBAR_MAX_WIDTH = 520;

function SidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const { open, isMobile } = useSidebar();

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!open || isMobile) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampSidebarWidth(
          startWidth + moveEvent.clientX - startX,
        );
        onWidthChange(nextWidth);
      };

      const handlePointerUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [onWidthChange, open, isMobile, width],
  );

  // On narrow screens the sidebar collapses into a Sheet overlay, so there is
  // no docked panel to resize — hide the drag border entirely.
  if (!open || isMobile) return null;

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      tabIndex={0}
      className="absolute inset-y-0 z-40 w-2 -translate-x-1 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-sidebar-border/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      style={{ left: `${width}px` }}
      onPointerDown={handlePointerDown}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        onWidthChange(clampSidebarWidth(width + direction * 16));
      }}
    />
  );
}

function clampSidebarWidth(width: number): number {
  return Math.min(
    DESKTOP_SIDEBAR_MAX_WIDTH,
    Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}
