import { Link, useRouterState } from "@tanstack/react-router";
import { GalleryVerticalEnd, Hexagon, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COMPUTER_SPACES_ROUTE,
  COMPUTER_THREADS_ROUTE,
  adminAppHref,
} from "@/lib/computer-routes";

const tabs = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    href: COMPUTER_THREADS_ROUTE,
    match: (pathname: string) =>
      pathname === COMPUTER_THREADS_ROUTE ||
      pathname.startsWith(`${COMPUTER_THREADS_ROUTE}/`) ||
      isSpaceThreadPath(pathname) ||
      pathname === "/new",
  },
  {
    id: "spaces",
    label: "Spaces",
    icon: GalleryVerticalEnd,
    href: COMPUTER_SPACES_ROUTE,
    match: (pathname: string) =>
      pathname === COMPUTER_SPACES_ROUTE ||
      (pathname.startsWith(`${COMPUTER_SPACES_ROUTE}/`) &&
        !isSpaceThreadPath(pathname)),
  },
] as const;

export function AppModeTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const adminHref = adminAppHref();

  return (
    <nav aria-label="Application modes" className="flex items-center gap-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.id}
            to={tab.href}
            className={cn(
              "relative flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold text-sidebar-foreground/65 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              active && "text-sidebar-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate group-data-[collapsible=icon]:sr-only">
              {tab.label}
            </span>
            {active ? (
              <span className="absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-sidebar-foreground" />
            ) : null}
          </Link>
        );
      })}
      <a
        href={adminHref}
        className="relative flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold text-sidebar-foreground/65 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Hexagon className="size-4 shrink-0" />
        <span className="truncate group-data-[collapsible=icon]:sr-only">
          Admin
        </span>
      </a>
    </nav>
  );
}

function isSpaceThreadPath(pathname: string) {
  return /^\/spaces\/[^/]+\/threads\/[^/]+/.test(pathname);
}
