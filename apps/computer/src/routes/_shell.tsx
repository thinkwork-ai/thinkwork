import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@thinkwork/ui";
import { AppTopBar } from "@/components/AppTopBar";
import { ComputerSidebar } from "@/components/ComputerSidebar";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
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
