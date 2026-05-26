import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { SidebarInset, SidebarProvider, useSidebar } from "@thinkwork/ui";
import { AppTopBar } from "@/components/AppTopBar";
import { DesktopApplicationHeader } from "@/components/DesktopApplicationHeader";
import { SpacesSidebar } from "@/components/SpacesSidebar";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { NoTenantAssigned } from "@/components/NoTenantAssigned";
import { useTenant } from "@/context/TenantContext";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { requestDesktopNotificationPermission } from "@/lib/desktop-notifications";

export const Route = createFileRoute("/_authed/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const { noTenantAssigned, isLoading } = useTenant();
  const isDesktop = isDesktopBuild();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DESKTOP_SIDEBAR_WIDTH);

  useEffect(() => {
    void requestDesktopNotificationPermission();
  }, []);

  if (noTenantAssigned) {
    return <NoTenantAssigned />;
  }

  if (isLoading) {
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

  const shellChrome = (
    <>
      <SpacesSidebar />
      <SidebarInset
        className={`min-h-0 min-w-0 flex flex-col ${isDesktop ? "relative h-full" : "h-svh"}`}
      >
        {isDesktop ? <DesktopApplicationHeader /> : <AppTopBar />}
        <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </>
  );

  return (
    <SidebarProvider
      open={isDesktop ? sidebarOpen : undefined}
      onOpenChange={isDesktop ? setSidebarOpen : undefined}
      className={
        isDesktop
          ? "desktop-shell relative h-svh min-h-0 overflow-hidden"
          : undefined
      }
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--desktop-sidebar-active-width": sidebarOpen
            ? `${sidebarWidth}px`
            : "0px",
        } as React.CSSProperties
      }
    >
      {isDesktop ? (
        <>
          <DesktopSidebarResizeHandle
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          />
          <div className="flex h-full min-h-0 w-full">{shellChrome}</div>
        </>
      ) : (
        shellChrome
      )}
    </SidebarProvider>
  );
}

const DESKTOP_SIDEBAR_WIDTH = 300;
const DESKTOP_SIDEBAR_MIN_WIDTH = 240;
const DESKTOP_SIDEBAR_MAX_WIDTH = 520;

function DesktopSidebarResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) {
  const { open } = useSidebar();

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!open) return;

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
    [onWidthChange, open, width],
  );

  if (!open) return null;

  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      tabIndex={0}
      className="absolute inset-y-0 z-[60] w-2 -translate-x-1 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-sidebar-border/70 hover:after:bg-sidebar-foreground/35 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
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
