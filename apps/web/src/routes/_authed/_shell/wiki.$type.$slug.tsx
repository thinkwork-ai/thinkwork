import { createFileRoute } from "@tanstack/react-router";
import { PAGE_TYPES, type WikiPageType } from "@thinkwork/graph";
import { useTenant } from "@/context/TenantContext";
import { WikiPageView } from "@/components/memory/WikiPageView";

export const Route = createFileRoute("/_authed/_shell/wiki/$type/$slug")({
  component: WikiPageRoute,
});

function WikiPageRoute() {
  const { type, slug } = Route.useParams();
  const { tenantId, userId } = useTenant();

  // The URL carries a lowercased page type (`entity` / `topic` / `decision`);
  // normalize back to the WikiPageType enum the resolver expects.
  const normalized = type.toUpperCase();
  const pageType = (PAGE_TYPES as readonly string[]).includes(normalized)
    ? (normalized as WikiPageType)
    : null;

  if (!pageType) {
    return (
      <main className="flex h-full min-h-0 w-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Unknown wiki page type.</p>
      </main>
    );
  }

  return (
    <WikiPageView
      tenantId={tenantId}
      userId={userId}
      type={pageType}
      slug={slug}
    />
  );
}
