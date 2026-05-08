import { Link, useRouterState } from "@tanstack/react-router";
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

interface PlaceholderThread {
  id: string;
  title: string;
}

const PLACEHOLDER_THREADS: PlaceholderThread[] = [
  { id: "welcome", title: "Welcome to your Computer" },
  { id: "sample-1", title: "Sample thread — placeholder" },
  { id: "sample-2", title: "Real threads land in the next slice" },
];

function handleNewThread() {
  // Stub — real createThread mutation lands in the next slice.
  console.info(
    "[apps/computer] New Thread CTA clicked. Real createThread mutation lands in the next slice (parent U8).",
  );
}

export function ComputerSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
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
                  onClick={handleNewThread}
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
                const isActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
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
              {PLACEHOLDER_THREADS.map((thread) => {
                const threadPath = `/threads/${thread.id}`;
                const isActive =
                  pathname === threadPath || pathname.startsWith(`${threadPath}/`);
                return (
                  <SidebarMenuItem key={thread.id}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={thread.title}>
                      <Link to="/threads/$id" params={{ id: thread.id }}>
                        <span className="truncate">{thread.title}</span>
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
