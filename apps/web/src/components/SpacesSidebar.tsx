import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  BookOpen,
  CircleUserRound,
  LogOut,
  RefreshCw,
  Settings,
  TriangleAlert,
} from "lucide-react";
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
import { BrandMark, PoweredByThinkWork } from "@/components/shell/BrandMark";
import { ChatSidebar } from "@/components/shell/ChatSidebar";
import {
  SidebarHealthProvider,
  useSidebarHealth,
} from "@/components/shell/sidebar-health";
import { requestSpacesComposerFocus } from "@/lib/composer-focus";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import { openInNewTab } from "@/lib/open-in-new-tab";
import { rememberSettingsReturnTo } from "@/lib/settings-return";
import { SidebarDeployedReleaseQuery } from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";

export function SpacesSidebar() {
  const { state, setOpen } = useSidebar();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isCollapsed = state === "collapsed";
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
  return (
    <SidebarHealthProvider>
      <Sidebar collapsible="icon">
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
              <BrandMark collapsible />
            </Link>
          </div>
        </SidebarHeader>

        <SidebarContent className="min-h-0">
          <ChatSidebar />
        </SidebarContent>

        <SidebarFooter className="p-2 group-data-[collapsible=icon]:p-1">
          <AccountMenu
            name={user?.name}
            email={user?.email}
            deployedReleaseVersion={deployedReleaseVersion}
            onOpenSettings={() => {
              rememberSettingsReturnTo(currentPath);
              navigate({ to: "/settings" });
            }}
            onOpenProfile={() => {
              navigate({ to: "/profile" });
            }}
            onSignOut={() => {
              signOut();
            }}
          />
          {/* Tuck the attribution right under the Settings row — the
              footer's own gap already provides enough separation. */}
          <PoweredByThinkWork className="-mt-1 pb-1 pl-3.5 pr-2 pt-0" />
        </SidebarFooter>
      </Sidebar>
    </SidebarHealthProvider>
  );
}

function AccountMenu({
  name,
  email,
  deployedReleaseVersion,
  onOpenSettings,
  onOpenProfile,
  onSignOut,
}: {
  name?: string | null;
  email?: string | null;
  deployedReleaseVersion?: string | null;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
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
          className="ml-px flex h-9 w-full min-w-0 items-center gap-2 rounded-md py-2 pl-2.5 pr-2 text-left text-sidebar-foreground/85 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          aria-label={
            sidebarHealth.hasError
              ? "Open settings menu (sync issue)"
              : "Open settings menu"
          }
        >
          <span className="relative shrink-0">
            <Settings className="size-4" />
            {sidebarHealth.hasError ? (
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
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        {/* Docs open in their own tab: reading a guide should never cost you
            the thread you were mid-way through. */}
        <DropdownMenuItem
          data-testid="sidebar-docs"
          onSelect={() => openInNewTab("/docs")}
        >
          <BookOpen className="mr-2 h-4 w-4" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenProfile}>
          <CircleUserRound className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
