import { createFileRoute } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceSettingsPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/settings",
)({
  component: SpaceSettingsRoute,
});

function SpaceSettingsRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="settings">
      {({ space, draft, setDraft, refreshSpace }) => (
        <SpaceSettingsPanel
          space={space}
          draft={draft}
          setDraft={setDraft}
          refreshSpace={refreshSpace}
        />
      )}
    </SpaceDetailChrome>
  );
}
