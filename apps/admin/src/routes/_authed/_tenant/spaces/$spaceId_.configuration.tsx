import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceConfigurationPanel,
  SpaceDetailChrome,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/configuration",
)({
  component: SpaceConfigurationRoute,
});

function SpaceConfigurationRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="configuration">
      {({ space, draft, setDraft, refreshSpace }) => (
        <SpaceConfigurationPanel
          space={space}
          draft={draft}
          setDraft={setDraft}
          refreshSpace={refreshSpace}
        />
      )}
    </SpaceDetailChrome>
  );
}
