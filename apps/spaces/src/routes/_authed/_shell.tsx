import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarInset, SidebarProvider } from "@thinkwork/ui";
import { AppTopBar } from "@/components/AppTopBar";
import { DesktopApplicationHeader } from "@/components/DesktopApplicationHeader";
import { SpacesSidebar } from "@/components/SpacesSidebar";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { NoTenantAssigned } from "@/components/NoTenantAssigned";
import { UpdateBanner } from "@/components/update-banner";
import { useTenant } from "@/context/TenantContext";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { requestDesktopNotificationPermission } from "@/lib/desktop-notifications";

export const Route = createFileRoute("/_authed/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const { noTenantAssigned, isLoading } = useTenant();
  const isDesktop = isDesktopBuild();

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
        className={`min-h-0 min-w-0 flex flex-col ${isDesktop ? "h-full pt-[var(--desktop-app-header-height)]" : "h-svh"}`}
      >
        {isDesktop ? null : <AppTopBar />}
        <UpdateBanner />
        <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </>
  );

  return (
    <SidebarProvider
      className={
        isDesktop
          ? "desktop-shell relative h-svh min-h-0 overflow-hidden"
          : undefined
      }
      style={{ "--sidebar-width": "300px" } as React.CSSProperties}
    >
      {isDesktop ? (
        <>
          <DesktopApplicationHeader />
          <div className="flex h-full min-h-0 w-full">{shellChrome}</div>
        </>
      ) : (
        shellChrome
      )}
    </SidebarProvider>
  );
}
