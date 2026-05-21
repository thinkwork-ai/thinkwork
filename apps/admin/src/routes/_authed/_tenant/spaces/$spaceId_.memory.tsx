import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceMemoryPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/memory",
)({
  component: SpaceMemoryRoute,
});

function SpaceMemoryRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="memory">
      {() => <SpaceMemoryPanel />}
    </SpaceDetailChrome>
  );
}
