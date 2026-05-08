import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  Bot,
  Inbox,
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
  { to: "/computer", icon: Monitor, label: "Computer" },
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

  const [{ data: threadsData, fetching: threadsFetching, error: threadsError }] =
    useQuery<ThreadsResult>({
      query: ComputerThreadsQuery,
      variables: {
        tenantId: tenantId ?? "",
        computerId: computerId ?? "",
        limit: THREAD_LIMIT,
      },
      pause: !tenantId || !computerId,
    });

  const threads = threadsData?.threads ?? [];

  return (
    <>
      <Sidebar>
        <SidebarHeader className="px-3 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <span className="text-base font-semibold tracking-tight">ThinkWork</span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setNewThreadOpen(true)}
                    tooltip="New Thread"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 data-[active=true]:bg-primary/90"
                  >
                    <PenSquare />
                    <span>New Thread</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
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

          <SidebarGroup>
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
                      <span>No threads yet — click New Thread</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  threads.map((thread) => {
                    const threadPath = `/threads/${thread.id}`;
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
                          <Link to="/threads/$id" params={{ id: thread.id }}>
                            <span className="truncate">
                              {thread.title?.trim() ? thread.title : "(Untitled)"}
                            </span>
                          </Link>
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
