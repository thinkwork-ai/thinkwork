import { useEffect, useState, useCallback } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  MessagesSquare,
  Inbox,
  Bot,
  Monitor,
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
  Network,
  ScrollText,
  AppWindow,
} from "lucide-react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { apiFetch, NotReadyError } from "@/lib/api-fetch";
import {
  InboxItemsListQuery,
  AgentsListQuery,
  ComputersListQuery,
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
  SidebarTrigger,
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
  const { state, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
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

  const [computersResult] = useQuery({
    query: ComputersListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const computerCount = computersResult.data?.computers?.length ?? 0;

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

  // REST-based active counts for navigation badges. Highest-traffic REST call
  // site in the admin — fires on every tenant-scoped page load. If the auth
  // session hasn't hydrated yet apiFetch throws NotReadyError; we bump a
  // retry counter so the effect re-fires on the next tick once the token is
  // available. Other errors are non-fatal for the cosmetic count badges.
  const [activeScheduledJobs, setActiveScheduledJobs] = useState(0);
  const [authRetryTick, setAuthRetryTick] = useState(0);

  const fetchManageCounts = useCallback(async () => {
    if (!tenantId) return;
    const extraHeaders = { "x-tenant-id": tenantId };
    try {
      const jobs = await apiFetch<{ enabled: boolean }[]>(
        "/api/scheduled-jobs",
        { extraHeaders },
      );
      setActiveScheduledJobs(jobs.filter((j) => j.enabled).length);
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
    {
      to: "/computers",
      icon: Monitor,
      label: "Computers",
      badge: computerCount,
    },
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
      label: "Scheduled Jobs",
      badge: activeScheduledJobs,
    },
    {
      to: "/automations/webhooks",
      icon: Webhook,
      label: "Webhooks",
    },
  ];

  const agentsItems: NavItem[] = [
    { to: "/agents", icon: Bot, label: "Agents", badge: agentCount },
    { to: "/agent-templates", icon: LayoutTemplate, label: "Templates" },
    { to: "/knowledge", icon: Brain, label: "Memory" },
    { to: "/capabilities", icon: Puzzle, label: "Skills and Tools" },
    { to: "/evaluations", icon: ShieldCheck, label: "Evaluations" },
  ];

  // Billing is intentionally hidden — flip BILLING_VISIBLE back on when ready.
  const BILLING_VISIBLE = false;
  const manageItems: NavItem[] = [
    { to: "/analytics", icon: BarChart3, label: "Analytics" },
    { to: "/applets", icon: AppWindow, label: "Artifacts" },
    { to: "/people", icon: Users, label: "People" },
    { to: "/compliance", icon: ScrollText, label: "Compliance" },
    { to: "/security", icon: Shield, label: "Security Center" },
    { to: "/symphony", icon: Network, label: "Symphony" },
    ...(BILLING_VISIBLE && isOwner
      ? [{ to: "/billing", icon: CreditCard, label: "Billing" } as NavItem]
      : []),
    { to: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="pb-0">
        <div className="flex items-center gap-1">
          <SidebarMenu className="flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link
                  to="/dashboard"
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
                  <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
                    <span className="text-base font-semibold tracking-tight leading-none truncate">
                      ThinkWork
                    </span>
                    <span className="text-xs text-muted-foreground leading-none truncate mt-0.5">
                      Administration
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="mt-0.5 self-start group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:p-2">
          <SidebarGroupContent>
            <NavItems items={workItems} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:p-2">
          <SidebarGroupLabel>Automations</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={automationsItems} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:p-2">
          <SidebarGroupLabel>Managed Harness</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={agentsItems} />
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="group-data-[collapsible=icon]:p-2">
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={manageItems} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </ShadcnSidebar>
  );
}
