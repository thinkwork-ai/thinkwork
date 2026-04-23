import { useEffect, useState, useCallback } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard,
  MessagesSquare,
  Inbox,
  Bot,
  Users,
  Repeat,
  BarChart3,
  Settings,
  CreditCard,
  Puzzle,
  Brain,
  FileText,
  Network,
  Webhook,
  Shield,
  CalendarClock,
  BookOpen,
  LayoutTemplate,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { InboxItemsListQuery, AgentsListQuery, ThreadsListQuery, ThreadsPagedQuery, RoutinesListQuery } from "@/lib/graphql-queries";
import { InboxItemStatus } from "@/gql/graphql";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  useSidebar,
} from "@/components/ui/sidebar";

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number | string;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function NavItems({ items }: { items: NavItem[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      {items.map((item) => {
        const isActive =
          item.to === "/dashboard"
            ? pathname === "/dashboard" || pathname === "/"
            : pathname.startsWith(item.to);

        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={item.label}
            >
              <Link
                to={item.to}
                onClick={() => isMobile && setOpenMobile(false)}
              >
                <item.icon />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
            {item.badge != null && item.badge !== 0 && (
              <SidebarMenuBadge>
                <Badge variant="outline" className="h-5 min-w-5 px-1.5 text-[10px] font-medium tabular-nums border-zinc-400 dark:border-zinc-500">
                  {item.badge}
                </Badge>
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const { tenantId } = useTenant();
  const [inboxResult] = useQuery({
    query: InboxItemsListQuery,
    variables: { tenantId: tenantId!, status: InboxItemStatus.Pending },
    pause: !tenantId,
  });
  const pendingInboxCount = inboxResult.data?.inboxItems?.length ?? 0;

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const agentCount = agentsResult.data?.agents?.length ?? 0;


  const [threadsResult] = useQuery({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: tenantId!,
      limit: 1,
    },
    pause: !tenantId,
  });
  const threadCount = (threadsResult.data as any)?.threadsPaged?.totalCount ?? 0;

  // REST-based active counts for Manage section
  const API_URL = import.meta.env.VITE_API_URL || "";
  const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

  const [activeScheduledJobs, setActiveScheduledJobs] = useState(0);
  const [activeRoutines, setActiveRoutines] = useState(0);
  const [activeWebhooks, setActiveWebhooks] = useState(0);

  const fetchManageCounts = useCallback(async () => {
    if (!tenantId) return;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-tenant-id": tenantId,
      ...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
    };
    try {
      const [jobs, webhooks] = await Promise.all([
        fetch(`${API_URL}/api/scheduled-jobs`, { headers }).then((r) => r.json()) as Promise<{ enabled: boolean }[]>,
        fetch(`${API_URL}/api/webhooks`, { headers }).then((r) => r.json()) as Promise<{ enabled: boolean }[]>,
      ]);
      setActiveScheduledJobs(jobs.filter((j) => j.enabled).length);
      setActiveWebhooks(webhooks.filter((w) => w.enabled).length);
    } catch { /* non-fatal */ }
  }, [tenantId, API_URL, API_AUTH_SECRET]);

  useEffect(() => { fetchManageCounts(); }, [fetchManageCounts]);

  // Routines active count from GraphQL
  const [routinesResult] = useQuery({
    query: RoutinesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const routineActiveCount = (routinesResult.data?.routines ?? []).filter(
    (r: any) => r.status === "ACTIVE",
  ).length;

  // Role gate for owner-only nav entries (Billing). Cheap one-shot fetch
  // on mount; the role doesn't change while a session is alive.
  const { getToken } = useAuth();
  const [callerRole, setCallerRole] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { role?: string | null };
        if (!cancelled) setCallerRole(data.role ?? null);
      } catch {
        /* silent; Billing just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);
  const isOwner = callerRole === "owner";

  const workItems: NavItem[] = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/threads", icon: MessagesSquare, label: "Threads", badge: threadCount ? formatCount(threadCount) : undefined },
    { to: "/inbox", icon: Inbox, label: "Inbox", badge: pendingInboxCount },
  ];

  const agentsItems: NavItem[] = [
    { to: "/agents", icon: Bot, label: "Agents", badge: agentCount },
    { to: "/agent-templates", icon: LayoutTemplate, label: "Agent Templates" },
    { to: "/evaluations", icon: ShieldCheck, label: "Evaluations" },
    { to: "/capabilities", icon: Puzzle, label: "Capabilities" },
    { to: "/memory", icon: Brain, label: "Memories" },
    { to: "/wiki", icon: Network, label: "Wiki Pages" },
    { to: "/knowledge-bases", icon: BookOpen, label: "Knowledge Bases" },
    { to: "/security", icon: Shield, label: "Security Center" },
  ];

  const manageItems: NavItem[] = [
    { to: "/analytics", icon: BarChart3, label: "Analytics" },
    { to: "/scheduled-jobs", icon: CalendarClock, label: "Automations" },
    { to: "/webhooks", icon: Webhook, label: "Webhooks" },
    { to: "/humans", icon: Users, label: "Humans" },
    ...(isOwner
      ? [{ to: "/billing", icon: CreditCard, label: "Billing" } as NavItem]
      : []),
    { to: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="pb-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <img
                  src="/logo.png"
                  alt="ThinkWork"
                  className="h-6 w-8 shrink-0 object-contain"
                />
                <span className="text-lg font-semibold truncate">
                  ThinkWork
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>Work</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={workItems} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Agents</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={agentsItems} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={manageItems} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </ShadcnSidebar>
  );
}
