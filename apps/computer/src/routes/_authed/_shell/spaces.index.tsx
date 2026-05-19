import { Link, createFileRoute } from "@tanstack/react-router";
import { GalleryVerticalEnd } from "lucide-react";
import { useQuery } from "urql";
import { Badge } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { SpacesQuery } from "@/lib/graphql-queries";
import {
  formatSpaceDate,
  formatSpaceLabel,
  type SpaceSummary,
} from "@/components/spaces/space-types";

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  component: SpacesPage,
});

interface SpacesResult {
  spaces?: SpaceSummary[] | null;
}

function SpacesPage() {
  const { tenantId } = useTenant();
  const [{ data, fetching, error }] = useQuery<SpacesResult>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const spaces = data?.spaces ?? [];

  usePageHeaderActions({
    title: "Spaces",
    subtitle: fetching && !data ? "Loading..." : `${spaces.length} active`,
    documentTitle: "Spaces",
  });

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {error ? (
        <SpacesState label={error.message} tone="error" />
      ) : fetching && !data ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingShimmer />
        </div>
      ) : spaces.length === 0 ? (
        <SpacesState label="No Spaces available" />
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto p-4 sm:grid-cols-2 xl:grid-cols-3">
          {spaces.map((space) => (
            <SpaceCard key={space.id} space={space} />
          ))}
        </div>
      )}
    </main>
  );
}

function SpaceCard({ space }: { space: SpaceSummary }) {
  return (
    <Link
      to="/spaces/$spaceId"
      params={{ spaceId: space.id }}
      className="flex min-h-[136px] flex-col justify-between rounded-md border bg-card p-4 text-card-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GalleryVerticalEnd className="size-4 shrink-0 text-primary" />
            <h2 className="truncate text-base font-semibold">{space.name}</h2>
          </div>
          {space.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {space.description}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="rounded-full text-xs">
          {formatSpaceLabel(space.kind) || "Space"}
        </Badge>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{space.slug}</span>
        <span>{formatSpaceDate(space.updatedAt)}</span>
      </div>
    </Link>
  );
}

function SpacesState({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={`flex flex-1 items-center justify-center px-4 text-center text-sm ${
        tone === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {label}
    </div>
  );
}
