import { Link } from "@tanstack/react-router";
import { GalleryVerticalEnd } from "lucide-react";
import {
  Badge,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import {
  formatCompactCount,
  formatRelativeDate,
  type SpaceNavSummary,
} from "./chat-sidebar-types";

interface SpaceNavSectionProps {
  spaces: SpaceNavSummary[];
  activeSpaceId?: string | null;
  isLoading?: boolean;
  error?: string | null;
}

export function SpaceNavSection({
  spaces,
  activeSpaceId,
  isLoading = false,
  error,
}: SpaceNavSectionProps) {
  return (
    <SidebarGroup className="px-3 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="h-auto px-0 text-[0.78rem] font-semibold text-sidebar-foreground">
        Spaces
      </SidebarGroupLabel>
      {error ? (
        <p className="rounded-md border border-destructive/40 px-2 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : isLoading ? (
        <p className="px-2 py-2 text-xs text-sidebar-foreground/60">
          Loading Spaces...
        </p>
      ) : spaces.length === 0 ? (
        <p className="px-2 py-2 text-xs text-sidebar-foreground/55">
          No Spaces yet
        </p>
      ) : (
        <SidebarMenu className="gap-0.5">
          {spaces.map((space) => {
            const unread = space.unreadThreadCount ?? 0;
            const active = space.id === activeSpaceId;
            return (
              <SidebarMenuItem key={space.id}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={space.name ?? space.slug ?? "Space"}
                  className={cn(
                    "h-auto min-h-10 items-start py-2",
                    active && "font-medium",
                  )}
                >
                  <Link
                    to="/threads"
                    search={{ spaceId: space.id }}
                    aria-current={active ? "page" : undefined}
                  >
                    <GalleryVerticalEnd className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {space.name ?? space.slug ?? "Space"}
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-normal text-sidebar-foreground/55">
                        {space.slug}
                        {space.lastActivityAt
                          ? ` · ${formatRelativeDate(space.lastActivityAt)}`
                          : ""}
                      </span>
                    </span>
                    {unread > 0 ? (
                      <Badge
                        variant="outline"
                        className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px]"
                      >
                        {formatCompactCount(unread)}
                      </Badge>
                    ) : null}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
}
