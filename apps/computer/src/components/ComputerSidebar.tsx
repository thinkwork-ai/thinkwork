import { useMemo } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  Brain,
  Monitor,
  PenSquare,
  Repeat,
  SlidersHorizontal,
  Shapes,
} from "lucide-react";
import {
  Badge,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@thinkwork/ui";
import type { FileRouteTypes } from "@/routeTree.gen";
import { useTenant } from "@/context/TenantContext";
import {
  COMPUTER_APPS_ROUTE,
  COMPUTER_MEMORY_ROUTE,
  COMPUTER_NEW_THREAD_ROUTE,
  COMPUTER_WORKBENCH_ROUTE,
} from "@/lib/computer-routes";
import { ComputerApprovalsQuery } from "@/lib/graphql-queries";

interface NavItem {
  href: FileRouteTypes["to"];
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
}

interface ApprovalsResult {
  inboxItems: Array<{ id: string; type: string }>;
}

export function ComputerSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { tenantId } = useTenant();
  const { state, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [{ data: approvalsData }] = useQuery<ApprovalsResult>({
    query: ComputerApprovalsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const pendingApprovalCount = (approvalsData?.inboxItems ?? []).filter(
    (item) => item.type === "computer_approval",
  ).length;
  const navItems = useMemo<NavItem[]>(
    () => [
      {
        href: COMPUTER_WORKBENCH_ROUTE,
        icon: Monitor,
        label: "Computer",
        badge: pendingApprovalCount,
      },
      { href: COMPUTER_APPS_ROUTE, icon: Shapes, label: "Apps" },
      { href: "/automations", icon: Repeat, label: "Automations" },
      { href: COMPUTER_MEMORY_ROUTE, icon: Brain, label: "Memory" },
      { href: "/customize", icon: SlidersHorizontal, label: "Customize" },
    ],
    [pendingApprovalCount],
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pb-0">
        <div className="flex items-center gap-1">
          <SidebarMenu className="flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link
                  to={COMPUTER_WORKBENCH_ROUTE}
                  onClick={(event) => {
                    if (isCollapsed) {
                      event.preventDefault();
                      setOpen(true);
                    }
                  }}
                >
                  <img
                    src="/logo.png"
                    alt="ThinkWork"
                    className="h-9 w-9 shrink-0 object-contain"
                  />
                  <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-base font-semibold leading-none tracking-tight">
                      ThinkWork
                    </span>
                    <span className="mt-0.5 truncate text-xs leading-none text-muted-foreground">
                      Cloud Computer
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:p-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === COMPUTER_NEW_THREAD_ROUTE}
                  tooltip="New"
                >
                  <Link to={COMPUTER_NEW_THREAD_ROUTE}>
                    <PenSquare />
                    <span>New</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`) ||
                  (item.href === COMPUTER_WORKBENCH_ROUTE &&
                    pathname.startsWith(`${COMPUTER_NEW_THREAD_ROUTE}/`));
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                    >
                      <Link to={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                        {item.badge ? (
                          <Badge
                            variant="outline"
                            className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px]"
                          >
                            {item.badge}
                          </Badge>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
