import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
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
import { DesktopNavigationControls } from "@/components/DesktopApplicationHeader";
import { requestSpacesComposerFocus } from "@/lib/composer-focus";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import { isDesktopBuild } from "@/lib/desktop-runtime";
import { rememberSettingsReturnTo } from "@/lib/settings-return";

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

  return (
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
          deployedReleaseVersion={deploymentProfile.releaseVersion}
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
  );
}

function AccountMenu({
  name,
  email,
  deployedReleaseVersion,
  onOpenSettings,
  onSignOut,
}: {
  name?: string | null;
  email?: string | null;
  deployedReleaseVersion?: string | null;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const displayName = name ?? email ?? "Account";
  const initials = getInitials(name, email);
  const releaseLabel = deployedReleaseVersion?.trim() || "unknown";
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
          aria-label="Open settings menu"
        >
          <Settings className="size-4 shrink-0" />
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
