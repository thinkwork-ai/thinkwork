import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  LogOut,
  RefreshCw,
  Settings,
  TriangleAlert,
} from "lucide-react";
import { IconPlug } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { ChatSidebar } from "@/components/shell/ChatSidebar";
import {
  SidebarHealthProvider,
  useSidebarHealth,
} from "@/components/shell/sidebar-health";
import { DesktopNavigationControls } from "@/components/DesktopApplicationHeader";
import { requestSpacesComposerFocus } from "@/lib/composer-focus";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { rememberSettingsReturnTo } from "@/lib/settings-return";
import {
  SettingsMyPluginActivationsQuery,
  SidebarDeployedReleaseQuery,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";

export function SpacesSidebar() {
  const { state, setOpen } = useSidebar();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isCollapsed = state === "collapsed";
  const isDesktop = isDesktopBuild();
  const deploymentProfile = useMemo(
    () => getSpacesDeploymentProfileSnapshot(),
    [],
  );
  // The deployed release is server truth (deploymentStatus reads the
  // evidence-bucket status pointer / SSM deployment profile). The query is
  // operator-gated server-side, so pause it for non-operators and fall back
  // to the client profile's VITE_RELEASE_VERSION (populated on customer
  // installs via the runner's runtime-config viteEnv).
  const { isOperator, roleResolved } = useTenant();
  const [deployedReleaseResult] = useQuery({
    query: SidebarDeployedReleaseQuery,
    pause: !(roleResolved && isOperator),
  });
  const deployedReleaseVersion =
    deployedReleaseResult.data?.deploymentStatus?.releaseVersion?.trim() ||
    deploymentProfile.releaseVersion;
  // Plugin activations that need re-auth surface on the footer health
  // affordance (plan 2026-06-12-001 U8) — an amber dot on the gear plus a
  // "Reconnect" entry in the menu, mirroring the sidebar-sync warning.
  const [pluginActivationsResult] = useQuery({
    query: SettingsMyPluginActivationsQuery,
  });
  const pluginReauthCount = (
    pluginActivationsResult.data?.myPluginActivations ?? []
  ).filter((activation) => activation.status === "needs_reauth").length;

  return (
    <SidebarHealthProvider>
      <Sidebar collapsible={isDesktop ? "offcanvas" : "icon"}>
        {isDesktop ? (
          <SidebarHeader className="desktop-app-header h-[var(--desktop-app-header-height)] shrink-0 justify-center bg-sidebar px-4 py-0 pl-20">
            <DesktopNavigationControls className="w-full" />
          </SidebarHeader>
        ) : (
          <SidebarHeader className="pb-3">
            <div className="flex items-center gap-2 px-1">
              <Link
                to="/new"
                search={{ spaceId: undefined }}
                onClick={(event) => {
                  if (isCollapsed) {
                    event.preventDefault();
                    setOpen(true);
                    return;
                  }
                  requestSpacesComposerFocus();
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                <img
                  src="/logo.png"
                  alt="ThinkWork"
                  className="h-7 w-7 shrink-0 object-contain"
                />
                <span className="truncate text-base font-semibold leading-none tracking-tight group-data-[collapsible=icon]:hidden">
                  ThinkWork
                </span>
              </Link>
            </div>
          </SidebarHeader>
        )}

        <SidebarContent className="min-h-0">
          <ChatSidebar />
        </SidebarContent>

        <SidebarFooter className="p-2 group-data-[collapsible=icon]:p-1">
          <AccountMenu
            name={user?.name}
            email={user?.email}
            deployedReleaseVersion={deployedReleaseVersion}
            pluginReauthCount={pluginReauthCount}
            onOpenPlugins={() => {
              rememberSettingsReturnTo(currentPath);
              navigate({ to: "/settings/plugins" });
            }}
            onOpenSettings={() => {
              rememberSettingsReturnTo(currentPath);
              navigate({ to: "/settings" });
            }}
            onSignOut={() => {
              signOut();
              navigate({
                to: "/sign-in",
                search: { next: currentPath },
                replace: true,
              });
            }}
          />
        </SidebarFooter>
      </Sidebar>
    </SidebarHealthProvider>
  );
}

function AccountMenu({
  name,
  email,
  deployedReleaseVersion,
  pluginReauthCount = 0,
  onOpenPlugins,
  onOpenSettings,
  onSignOut,
}: {
  name?: string | null;
  email?: string | null;
  deployedReleaseVersion?: string | null;
  /** Count of the caller's plugin activations in `needs_reauth`. */
  pluginReauthCount?: number;
  onOpenPlugins?: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const displayName = name ?? email ?? "Account";
  const initials = getInitials(name, email);
  const releaseLabel = deployedReleaseVersion?.trim() || "unknown";
  // Transient sidebar query failures surface here as a subtle amber dot on the
  // gear + a Retry action, rather than a dramatic red error in the thread list.
  const sidebarHealth = useSidebarHealth();
  // Logout is easy to hit by accident, so confirm before signing out. The
  // dialog is controlled (not trigger-based) because the dropdown unmounts its
  // own children on select, which would tear down a nested trigger mid-open.
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-px flex h-9 w-full min-w-0 items-center gap-2 rounded-md py-2 pl-2.5 pr-2 text-left text-sidebar-foreground/85 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          aria-label={
            sidebarHealth.hasError
              ? "Open settings menu (sync issue)"
              : pluginReauthCount > 0
                ? "Open settings menu (plugin reconnect needed)"
                : "Open settings menu"
          }
        >
          <span className="relative shrink-0">
            <Settings className="size-4" />
            {sidebarHealth.hasError || pluginReauthCount > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-sidebar"
                aria-hidden
              />
            ) : null}
          </span>
          <span className="truncate text-sm group-data-[collapsible=icon]:hidden">
            Settings
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72"
      >
        <DropdownMenuLabel className="font-normal">
          <div className="flex min-w-0 items-start gap-2">
            <Avatar size="xs">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-none">
                {displayName}
              </p>
              {email ? (
                <p className="mt-1 truncate text-xs leading-none text-muted-foreground">
                  {email}
                </p>
              ) : null}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sidebarHealth.hasError ? (
          <>
            <div className="flex items-start gap-2 px-2 py-1.5 text-xs text-amber-500">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>{sidebarHealth.message ?? "Couldn't sync your data."}</span>
            </div>
            <DropdownMenuItem
              onSelect={(event) => {
                // Keep the menu open so the user sees the retry resolve.
                event.preventDefault();
                sidebarHealth.refresh();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {pluginReauthCount > 0 ? (
          <>
            <div className="flex items-start gap-2 px-2 py-1.5 text-xs text-amber-500">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                {pluginReauthCount === 1
                  ? "A plugin connection needs to be reconnected."
                  : `${pluginReauthCount} plugin connections need to be reconnected.`}
              </span>
            </div>
            <DropdownMenuItem onSelect={() => onOpenPlugins?.()}>
              <IconPlug className="mr-2 h-4 w-4" />
              Reconnect plugins
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setConfirmSignOutOpen(true)}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="truncate px-2 py-1.5 font-mono text-xs text-muted-foreground">
          {releaseLabel}
        </div>
      </DropdownMenuContent>
      <AlertDialog
        open={confirmSignOutOpen}
        onOpenChange={setConfirmSignOutOpen}
      >
        <AlertDialogContent data-testid="logout-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You&rsquo;ll need to sign in again to get back to your spaces.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="logout-confirm"
              onClick={() => {
                // Close the dialog (don't preventDefault — that kept the modal
                // open over the sign-in redirect, so "Log out" looked dead),
                // then sign out.
                setConfirmSignOutOpen(false);
                onSignOut();
              }}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DropdownMenu>
  );
}

function getInitials(name?: string | null, email?: string | null) {
  if (name?.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email?.slice(0, 2).toUpperCase() ?? "??";
}
