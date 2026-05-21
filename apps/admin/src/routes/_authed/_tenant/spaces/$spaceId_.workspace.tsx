import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceWorkspacePanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/workspace",
)({
  component: SpaceWorkspaceRoute,
});

function SpaceWorkspaceRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="workspace">
      {() => <SpaceWorkspacePanel spaceId={spaceId} />}
    </SpaceDetailChrome>
  );
}
