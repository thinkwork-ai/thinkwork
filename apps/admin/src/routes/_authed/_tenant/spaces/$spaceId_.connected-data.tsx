import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceConnectedDataPanel,
  SpaceDetailChrome,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/connected-data",
)({
  component: SpaceConnectedDataRoute,
});

function SpaceConnectedDataRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="connected-data">
      {({ space, connectedDataRows }) => (
        <SpaceConnectedDataPanel
          space={space}
          connectedDataRows={connectedDataRows}
        />
      )}
    </SpaceDetailChrome>
  );
}
