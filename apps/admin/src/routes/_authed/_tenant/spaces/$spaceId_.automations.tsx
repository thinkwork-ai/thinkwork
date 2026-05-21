import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceAutomationsPanel,
  SpaceDetailChrome,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/automations",
)({
  component: SpaceAutomationsRoute,
});

function SpaceAutomationsRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="automations">
      {() => <SpaceAutomationsPanel />}
    </SpaceDetailChrome>
  );
}
