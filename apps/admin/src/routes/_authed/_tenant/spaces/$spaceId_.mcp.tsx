import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceMcpPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/mcp",
)({
  component: SpaceMcpRoute,
});

function SpaceMcpRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="mcp">
      {({ space }) => <SpaceMcpPanel space={space} />}
    </SpaceDetailChrome>
  );
}
