import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { TwinEntityDetail } from "@/components/settings/twin-explorer/TwinEntityDetail";

/**
 * Deep-linkable twin entity detail (THINK-327 U2). Un-nested from the
 * /settings/memory tab route (`memory_`) so this full-page view mounts its
 * own component instead of the tab host, which renders without an Outlet.
 */
export const Route = createFileRoute(
  "/_authed/settings/memory_/explorer/$entityType/$canonicalId",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { entityType, canonicalId } = Route.useParams();
  return (
    <OperatorGuard>
      <TwinEntityDetail entityType={entityType} canonicalId={canonicalId} />
    </OperatorGuard>
  );
}
