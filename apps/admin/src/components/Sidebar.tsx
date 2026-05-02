import { useEffect, useState, useCallback } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
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
  Webhook,
  Shield,
  CalendarClock,
  LayoutTemplate,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { apiFetch, NotReadyError } from "@/lib/api-fetch";
import {
  InboxItemsListQuery,
  AgentsListQuery,
  ThreadsPagedQuery,
  RoutinesListQuery,
} from "@/lib/graphql-queries";
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
    <SidebarMenu className="gap-0.5">
      {items.map((item) => {
        const isActive =
          item.to === "/dashboard"
            ? pathname === "/dashboard" || pathname === "/"
            : pathname.startsWith(item.to);

        return (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
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
                <Badge
                  variant="outline"
                  className="h-5 min-w-5 px-1.5 text-[10px] font-medium tabular-nums border-zinc-400 dark:border-zinc-500"
                >
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
  const threadCount =
    (threadsResult.data as any)?.threadsPaged?.totalCount ?? 0;

  // REST-based active counts for Manage section. Highest-traffic REST call
  // site in the admin — fires on every tenant-scoped page load. If the auth
  // session hasn't hydrated yet apiFetch throws NotReadyError; we bump a
  // retry counter so the effect re-fires on the next tick once the token is
  // available. Other errors are non-fatal for the cosmetic count badges.
  const [activeScheduledJobs, setActiveScheduledJobs] = useState(0);
  const [activeWebhooks, setActiveWebhooks] = useState(0);
  const [authRetryTick, setAuthRetryTick] = useState(0);

  const fetchManageCounts = useCallback(async () => {
    if (!tenantId) return;
    const extraHeaders = { "x-tenant-id": tenantId };
    try {
      const [jobs, webhooks] = await Promise.all([
        apiFetch<{ enabled: boolean }[]>("/api/scheduled-jobs", {
          extraHeaders,
        }),
        apiFetch<{ enabled: boolean }[]>("/api/webhooks", { extraHeaders }),
      ]);
      setActiveScheduledJobs(jobs.filter((j) => j.enabled).length);
      setActiveWebhooks(webhooks.filter((w) => w.enabled).length);
    } catch (err) {
      if (err instanceof NotReadyError) {
        // Auth still hydrating — schedule a retry on the next tick.
        const t = setTimeout(() => setAuthRetryTick((n) => n + 1), 100);
        return () => clearTimeout(t);
      }
      // Other failures are non-fatal for sidebar counts.
    }
  }, [tenantId]);

  useEffect(() => {
    fetchManageCounts();
  }, [fetchManageCounts, authRetryTick]);

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
  // on mount; the role doesn't change while a session is alive. If auth
  // hasn't hydrated yet we retry once on the next tick.
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [roleRetryTick, setRoleRetryTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const data = await apiFetch<{ role?: string | null }>("/api/auth/me");
        if (!cancelled) setCallerRole(data.role ?? null);
      } catch (err) {
        if (err instanceof NotReadyError && !cancelled) {
          timer = setTimeout(() => setRoleRetryTick((n) => n + 1), 100);
        }
        /* other errors: silent; Billing just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roleRetryTick]);
  const isOwner = callerRole === "owner";

  const workItems: NavItem[] = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/agents", icon: Bot, label: "Agents", badge: agentCount },
    {
      to: "/threads",
      icon: MessagesSquare,
      label: "Threads",
      badge: threadCount ? formatCount(threadCount) : undefined,
    },
    { to: "/inbox", icon: Inbox, label: "Inbox", badge: pendingInboxCount },
  ];

  const automationsItems: NavItem[] = [
    {
      to: "/automations/routines",
      icon: Repeat,
      label: "Routines",
      badge: routineActiveCount,
    },
    {
      to: "/automations/schedules",
      icon: CalendarClock,
      label: "Schedules",
      badge: activeScheduledJobs,
    },
    {
      to: "/automations/webhooks",
      icon: Webhook,
      label: "Webhooks",
      badge: activeWebhooks,
    },
  ];

  const agentsItems: NavItem[] = [
    { to: "/agent-templates", icon: LayoutTemplate, label: "Templates" },
    { to: "/capabilities", icon: Puzzle, label: "Capabilities" },
    { to: "/knowledge", icon: Brain, label: "Company Brain" },
    { to: "/evaluations", icon: ShieldCheck, label: "Evaluations" },
    { to: "/security", icon: Shield, label: "Security Center" },
  ];

  const manageItems: NavItem[] = [
    { to: "/analytics", icon: BarChart3, label: "Analytics" },
    { to: "/people", icon: Users, label: "People" },
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
          <SidebarGroupLabel>Automations</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={automationsItems} />
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
