import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  SpaceDetailChrome,
  SpaceMembersPanel,
} from "@/components/spaces/SpaceDetailChrome";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/members",
)({
  component: SpaceMembersRoute,
});

function SpaceMembersRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="members">
      {({ space }) => {
        if (space.accessMode !== "PRIVATE") {
          throw redirect({
            to: "/spaces/$spaceId/configuration",
            params: { spaceId },
          });
        }
        return (
          <SpaceMembersPanel spaceId={space.id} tenantId={space.tenantId} />
        );
      }}
    </SpaceDetailChrome>
  );
}
