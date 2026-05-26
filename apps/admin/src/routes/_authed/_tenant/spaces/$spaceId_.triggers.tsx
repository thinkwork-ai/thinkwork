import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceTriggersAdd,
  SpaceTriggersPanel,
  SpaceTriggersProvider,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/triggers",
)({
  component: SpaceTriggersRoute,
});

function SpaceTriggersRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceTriggersProvider spaceId={spaceId}>
      <SpaceDetailChrome
        spaceId={spaceId}
        activeTab="triggers"
        headerActions={({ space, refreshSpace }) => (
          <SpaceTriggersAdd space={space} refreshSpace={refreshSpace} />
        )}
      >
        {({ space, refreshSpace }) => (
          <SpaceTriggersPanel space={space} refreshSpace={refreshSpace} />
        )}
      </SpaceDetailChrome>
    </SpaceTriggersProvider>
  );
}
