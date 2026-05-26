import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceKbsPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute("/_authed/_tenant/spaces/$spaceId_/kbs")({
  component: SpaceKbsRoute,
});

function SpaceKbsRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="kbs">
      {({ space }) => <SpaceKbsPanel space={space} />}
    </SpaceDetailChrome>
  );
}
