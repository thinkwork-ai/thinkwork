import { useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  Inbox,
  ListTodo,
  Monitor,
  PenSquare,
  Repeat,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@thinkwork/ui";
import type { FileRouteTypes } from "@/routeTree.gen";
import { useTenant } from "@/context/TenantContext";
import {
  COMPUTER_TASKS_ROUTE,
  COMPUTER_WORKBENCH_ROUTE,
  computerTaskRoute,
} from "@/lib/computer-routes";
import {
  ComputerThreadsQuery,
  MyComputerQuery,
} from "@/lib/graphql-queries";
import { NewThreadDialog } from "@/components/NewThreadDialog";

interface NavItem {
  to: FileRouteTypes["to"];
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const PERMANENT_NAV: NavItem[] = [
  { to: COMPUTER_WORKBENCH_ROUTE, icon: Monitor, label: "Computer" },
  { to: COMPUTER_TASKS_ROUTE, icon: ListTodo, label: "Tasks" },
  { to: "/automations", icon: Repeat, label: "Automations" },
  { to: "/inbox", icon: Inbox, label: "Inbox" },
];

const THREAD_LIMIT = 50;

interface MyComputerResult {
  myComputer: { id: string; name?: string | null } | null;
}

interface Thread {
  id: string;
  title: string | null;
  createdAt?: string;
}

interface ThreadsResult {
  threads: Thread[];
}

export function ComputerSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { tenantId } = useTenant();
  const [newThreadOpen, setNewThreadOpen] = useState(false);

  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computerId = computerData?.myComputer?.id ?? null;

  // urql's document cache only invalidates queries that previously returned
  // the mutation's typename. When the threads list is empty, the cache has
  // no Thread typenames — so a freshly-created thread won't refresh the
  // sidebar. `additionalTypenames: ["Thread"]` registers the dependency so
  // any `Thread`-touching mutation (createThread) invalidates this query.
  const threadsContext = useMemo(() => ({ additionalTypenames: ["Thread"] }), []);

  const [{ data: threadsData, fetching: threadsFetching, error: threadsError }] =
    useQuery<ThreadsResult>({
      query: ComputerThreadsQuery,
      variables: {
        tenantId: tenantId ?? "",
        computerId: computerId ?? "",
        limit: THREAD_LIMIT,
      },
      pause: !tenantId || !computerId,
      context: threadsContext,
    });

  const threads = threadsData?.threads ?? [];

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to={COMPUTER_WORKBENCH_ROUTE}>
                  <img
                    src="/logo.png"
                    alt="ThinkWork"
                    className="h-9 w-9 shrink-0 object-contain"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-base font-semibold tracking-tight leading-none truncate">
                      ThinkWork
                    </span>
                    <span className="text-xs text-muted-foreground leading-none truncate mt-0.5">
                      Cloud Computer
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setNewThreadOpen(true)}
                    tooltip="New"
                  >
                    <PenSquare />
                    <span>New</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {PERMANENT_NAV.map((item) => {
                  const isActive =
                    pathname === item.to || pathname.startsWith(`${item.to}/`);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                        <Link to={item.to}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Threads</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {threadsFetching && threads.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton disabled className="opacity-60">
                      <span>Loading…</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : threadsError ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton disabled className="opacity-60">
                      <span className="text-destructive">Failed to load threads</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : threads.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton disabled className="opacity-60">
                      <span>No threads yet — click New</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  threads.map((thread) => {
                    const threadPath = computerTaskRoute(thread.id);
                    const isActive =
                      pathname === threadPath ||
                      pathname.startsWith(`${threadPath}/`);
                    return (
                      <SidebarMenuItem key={thread.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={thread.title ?? "(Untitled)"}
                        >
                          <a href={threadPath}>
                            <span className="truncate">
                              {thread.title?.trim() ? thread.title : "(Untitled)"}
                            </span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })
                )}
                {threads.length >= THREAD_LIMIT ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton disabled className="opacity-60">
                      <span className="text-xs">
                        Showing {THREAD_LIMIT} most recent — older threads coming soon
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <NewThreadDialog open={newThreadOpen} onOpenChange={setNewThreadOpen} />
    </>
  );
}
