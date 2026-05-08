import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@thinkwork/ui";
import { AppTopBar } from "@/components/AppTopBar";
import { ComputerSidebar } from "@/components/ComputerSidebar";
import { NoTenantAssigned } from "@/components/NoTenantAssigned";
import { useTenant } from "@/context/TenantContext";

export const Route = createFileRoute("/_authed/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const { noTenantAssigned, isLoading } = useTenant();

  if (noTenantAssigned) {
    return <NoTenantAssigned />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <SidebarProvider>
      <ComputerSidebar />
      <SidebarInset className="min-h-0 min-w-0 h-svh flex flex-col">
        <AppTopBar />
        <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
