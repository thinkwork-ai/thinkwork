import { Link, useRouterState } from "@tanstack/react-router";
import {
  Brain,
  GalleryVerticalEnd,
  Moon,
  Repeat,
  SlidersHorizontal,
  Shapes,
  Sun,
} from "lucide-react";
import {
  Button,
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
  UserMenu,
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
  const isCollapsed = state === "collapsed";
  const nextTheme = theme === "dark" ? "light" : "dark";
  const isChatMode =
    pathname === "/threads" ||
    pathname.startsWith("/threads/") ||
    /^\/spaces\/[^/]+\/threads\/[^/]+/.test(pathname) ||
    pathname === "/new";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="pb-3">
        <div className="flex items-center gap-2 px-1">
          <Link
            to="/new"
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
                Collaborative app
              </span>
            </div>
          </Link>
          <SidebarTrigger className="mt-0.5 shrink-0 self-start group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>

      <SidebarContent className="min-h-0">
        {isChatMode ? <ChatSidebar /> : <SecondaryNav pathname={pathname} />}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 group-data-[collapsible=icon]:p-1">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          {user ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:hidden">
              <UserMenu
                name={user.name}
                email={user.email}
                onSignOut={signOut}
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium leading-tight">
                  {user.name ?? user.email ?? "Account"}
                </div>
                {user.email ? (
                  <div className="truncate text-xs leading-tight text-sidebar-foreground/55">
                    {user.email}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:ml-0"
            aria-label={`Switch to ${nextTheme} mode`}
            title={`Switch to ${nextTheme} mode`}
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
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
