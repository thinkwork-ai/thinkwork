import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useRouterState } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@thinkwork/ui";
import { AppTopBar } from "@/components/AppTopBar";
import { ComputerSidebar } from "@/components/ComputerSidebar";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { NoTenantAssigned } from "@/components/NoTenantAssigned";
import { useTenant } from "@/context/TenantContext";

export const Route = createFileRoute("/_authed/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const { noTenantAssigned, isLoading } = useTenant();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isArtifactFullscreen = /^\/artifacts\/[^/]+$/.test(pathname);

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

  if (isArtifactFullscreen) {
    return (
      <div className="flex h-svh min-h-0 min-w-0 flex-col bg-background">
        <AppTopBar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={{ "--sidebar-width": "300px" } as React.CSSProperties}
    >
      <ComputerSidebar />
      <SidebarInset className="min-h-0 min-w-0 h-svh flex flex-col">
        <AppTopBar />
        <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
