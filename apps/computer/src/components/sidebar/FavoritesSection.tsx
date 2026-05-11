import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ChevronDown, Star } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { computerArtifactRoute } from "@/lib/computer-routes";
import { FavoriteArtifactsQuery } from "@/lib/graphql-queries";

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
    <Collapsible defaultOpen={false} className="group/favorites">
      <SidebarGroup
        className="group-data-[collapsible=icon]:hidden"
        data-testid="sidebar-favorites-group"
      >
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel
            asChild
            className="cursor-pointer select-none data-[state=open]:text-foreground"
          >
            <button
              type="button"
              data-testid="sidebar-favorites-trigger"
              aria-label="Toggle Favorites"
            >
              <Star className="mr-2 h-4 w-4" />
              <span>Favorites</span>
              <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=closed]/favorites:-rotate-90" />
            </button>
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu
              className="gap-0.5"
              data-testid="sidebar-favorites-list"
            >
              {favorites.map((favorite) => {
                const href = computerArtifactRoute(favorite.id);
                return (
                  <SidebarMenuItem key={favorite.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === href}
                      tooltip={favorite.title}
                    >
                      <Link to={href}>
                        <span className="truncate">{favorite.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
