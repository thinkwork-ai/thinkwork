import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceTriggersAdd,
  SpaceTriggersPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/triggers",
)({
  component: SpaceTriggersRoute,
});

function SpaceTriggersRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome
      spaceId={spaceId}
      activeTab="triggers"
      headerActions={() => <SpaceTriggersAdd />}
    >
      {({ space, refreshSpace }) => (
        <SpaceTriggersPanel space={space} refreshSpace={refreshSpace} />
      )}
    </SpaceDetailChrome>
  );
}
