import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceToolsPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute("/_authed/_tenant/spaces/$spaceId_/tools")(
  {
    component: SpaceToolsRoute,
  },
);

function SpaceToolsRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="tools">
      {() => <SpaceToolsPanel />}
    </SpaceDetailChrome>
  );
}
