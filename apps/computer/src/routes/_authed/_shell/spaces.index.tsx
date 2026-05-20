import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { GalleryVerticalEnd } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { SpacesQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  component: SpacesIndexPage,
});

interface SpaceSummary {
  id: string;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  unreadThreadCount?: number | null;
  lastActivityAt?: string | null;
}

interface SpacesResult {
  spaces?: SpaceSummary[] | null;
}

function SpacesIndexPage() {
  const { tenantId } = useTenant();
  usePageHeaderActions({ title: "Spaces" });

  const [{ data, fetching, error }] = useQuery<SpacesResult>({
    query: SpacesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const spaces = data?.spaces ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 md:p-8">
      {error ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {error.message}
        </div>
      ) : fetching && spaces.length === 0 ? (
        <div className="text-sm text-muted-foreground">Loading Spaces...</div>
      ) : spaces.length === 0 ? (
        <div className="rounded-md border p-6 text-sm text-muted-foreground">
          No Spaces yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {spaces.map((space) => (
            <Link
              key={space.id}
              to="/spaces/$spaceId"
              params={{ spaceId: space.id }}
              className="flex min-w-0 items-center gap-3 rounded-md border p-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <GalleryVerticalEnd className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {space.name ?? space.slug ?? "Space"}
                </div>
                {space.description ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {space.description}
                  </div>
                ) : null}
              </div>
              {space.unreadThreadCount ? (
                <Badge variant="outline">{space.unreadThreadCount}</Badge>
              ) : null}
            </Link>
          ))}
        </div>
      )}
      <Button asChild variant="outline" className="w-fit">
        <Link to="/new" search={{ spaceId: undefined }}>
          New chat
        </Link>
      </Button>
    </main>
  );
}
