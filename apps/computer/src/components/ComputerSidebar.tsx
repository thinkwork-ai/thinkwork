import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Brain,
  GalleryVerticalEnd,
  LogOut,
  Moon,
  Repeat,
  Settings,
  SlidersHorizontal,
  Shapes,
  Sun,
} from "lucide-react";
import {
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
  useTheme,
} from "@thinkwork/ui";
import type { FileRouteTypes } from "@/routeTree.gen";
import { useAuth } from "@/context/AuthContext";
import {
  COMPUTER_ARTIFACTS_ROUTE,
  COMPUTER_CUSTOMIZE_ROUTE,
  COMPUTER_MEMORY_ROUTE,
  COMPUTER_SPACES_ROUTE,
} from "@/lib/computer-routes";
import { ChatSidebar } from "@/components/shell/ChatSidebar";

interface NavItem {
  href: FileRouteTypes["to"];
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const secondaryNavItems: NavItem[] = [
  {
    href: COMPUTER_SPACES_ROUTE,
    icon: GalleryVerticalEnd,
    label: "Spaces",
  },
  { href: COMPUTER_ARTIFACTS_ROUTE, icon: Shapes, label: "Artifacts" },
  { href: "/automations", icon: Repeat, label: "Automations" },
  { href: COMPUTER_MEMORY_ROUTE, icon: Brain, label: "Memory" },
  {
    href: COMPUTER_CUSTOMIZE_ROUTE,
    icon: SlidersHorizontal,
    label: "Customize",
  },
];

export function ComputerSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { state, setOpen } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isCollapsed = state === "collapsed";
  const nextTheme = theme === "dark" ? "light" : "dark";
  const isChatMode = isChatSidebarPath(pathname);

  return (
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
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
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
              <span className="truncate text-xs text-sidebar-foreground/55">
                Spaces
              </span>
            </div>
          </Link>
          <SidebarTrigger className="mt-0.5 shrink-0 self-start group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent className="min-h-0">
        {settingsOpen || isChatMode ? (
          <ChatSidebar
            settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen}
          />
        ) : (
          <SecondaryNav pathname={pathname} />
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 group-data-[collapsible=icon]:p-1">
        <AccountMenu
          name={user?.name}
          email={user?.email}
          theme={theme}
          nextTheme={nextTheme}
          onOpenSettings={() => {
            setSettingsOpen(true);
            if (isCollapsed) setOpen(true);
          }}
          onToggleTheme={toggleTheme}
          onSignOut={signOut}
        />
      </SidebarFooter>
    </Sidebar>
  );
}

function AccountMenu({
  name,
  email,
  theme,
  nextTheme,
  onOpenSettings,
  onToggleTheme,
  onSignOut,
}: {
  name?: string | null;
  email?: string | null;
  theme: string;
  nextTheme: string;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const displayName = name ?? email ?? "Account";
  const initials = getInitials(name, email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          aria-label="Open account menu"
        >
          <Avatar size="xs">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-xs font-medium leading-tight">
              {displayName}
            </span>
            {email ? (
              <span className="block truncate text-xs leading-tight text-sidebar-foreground/55">
                {email}
              </span>
            ) : null}
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
          <div className="flex min-w-0 items-center gap-2">
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
        <DropdownMenuItem onSelect={onToggleTheme}>
          {theme === "dark" ? (
            <Sun className="mr-2 h-4 w-4" />
          ) : (
            <Moon className="mr-2 h-4 w-4" />
          )}
          Switch to {nextTheme} mode
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
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

export function isChatSidebarPath(pathname: string) {
  return (
    pathname === "/threads" ||
    pathname.startsWith("/threads/") ||
    /^\/spaces\/[^/]+\/threads\/[^/]+/.test(pathname) ||
    /^\/artifacts\/[^/]+$/.test(pathname) ||
    pathname === "/new"
  );
}

function SecondaryNav({ pathname }: { pathname: string }) {
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:p-2">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {secondaryNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
