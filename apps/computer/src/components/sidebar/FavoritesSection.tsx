import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ChevronDown, Pin } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  cn,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { computerArtifactRoute } from "@/lib/computer-routes";
import { FavoriteArtifactsQuery } from "@/lib/graphql-queries";
import { useArtifactPinToggle } from "@/components/artifacts/PinToggleButton";

interface FavoriteArtifact {
  id: string;
  title: string;
  type?: string | null;
  favoritedAt?: string | null;
}

interface FavoriteArtifactsResult {
  artifacts?: FavoriteArtifact[] | null;
}

interface FavoritesSectionProps {
  /** Test seam: pre-supplied favorites bypass the live query. */
  favorites?: FavoriteArtifact[];
}

const DEFAULT_FAVORITES_LIMIT = 20;

export function FavoritesSection({ favorites }: FavoritesSectionProps = {}) {
  if (favorites) {
    return <FavoritesSectionView favorites={favorites} />;
  }
  return <LiveFavoritesSection />;
}

function LiveFavoritesSection() {
  const { tenantId } = useTenant();
  const [{ data }] = useQuery<FavoriteArtifactsResult>({
    query: FavoriteArtifactsQuery,
    variables: {
      tenantId: tenantId ?? "",
      limit: DEFAULT_FAVORITES_LIMIT,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const favorites = data?.artifacts ?? [];
  return <FavoritesSectionView favorites={favorites} />;
}

function FavoritesSectionView({
  favorites,
}: {
  favorites: FavoriteArtifact[];
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Hide the section entirely when there are no favorites — no empty
  // shell, no header, no chrome.
  if (favorites.length === 0) {
    return null;
  }

  return (
    <Collapsible defaultOpen={false} className="group/pinned">
      <SidebarGroup
        className="group-data-[collapsible=icon]:hidden"
        data-testid="sidebar-pinned-group"
      >
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel
            asChild
            className="cursor-pointer select-none data-[state=open]:text-foreground"
          >
            <button
              type="button"
              data-testid="sidebar-pinned-trigger"
              aria-label="Toggle Pinned"
            >
              <Pin className="mr-2 h-4 w-4" />
              <span>Pinned</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=closed]/pinned:-rotate-90" />
            </button>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu
              className="gap-0.5"
              data-testid="sidebar-pinned-list"
            >
              {favorites.map((favorite) => (
                <PinnedSidebarRow
                  key={favorite.id}
                  favorite={favorite}
                  pathname={pathname}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

function PinnedSidebarRow({
  favorite,
  pathname,
}: {
  favorite: FavoriteArtifact;
  pathname: string;
}) {
  const href = computerArtifactRoute(favorite.id);
  const { isPinned, working, toggle } = useArtifactPinToggle(
    favorite.id,
    favorite.favoritedAt ?? null,
  );
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={pathname === href}
        tooltip={favorite.title}
      >
        <Link to={href}>
          <span className="truncate">{favorite.title}</span>
        </Link>
      </SidebarMenuButton>
      <SidebarMenuAction
        showOnHover
        aria-label={isPinned ? "Unpin artifact" : "Pin artifact"}
        aria-pressed={isPinned}
        data-testid={`sidebar-pinned-toggle-${favorite.id}`}
        disabled={working}
        onClick={(event) => {
          void toggle(event);
        }}
      >
        <Pin className={cn("h-4 w-4", isPinned && "fill-current")} />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
