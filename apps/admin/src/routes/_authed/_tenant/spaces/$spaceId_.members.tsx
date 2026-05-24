import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SpaceDetailChrome } from "@/components/spaces/SpaceDetailChrome";
import { SpaceMembersPanel } from "@/components/spaces/SpaceMembersPanel";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/members",
)({
  component: SpaceMembersRoute,
});

function SpaceMembersRoute() {
  const { spaceId } = Route.useParams();

  return (
    <SpaceDetailChrome spaceId={spaceId} activeTab="members">
      {({ space }) => (
        <MembersGuard
          spaceId={spaceId}
          accessMode={space.accessMode}
          tenantId={space.tenantId}
        >
          <SpaceMembersPanel spaceId={space.id} tenantId={space.tenantId} />
        </MembersGuard>
      )}
    </SpaceDetailChrome>
  );
}

function MembersGuard({
  spaceId,
  accessMode,
  children,
}: {
  spaceId: string;
  accessMode: string;
  tenantId: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const isPrivate = accessMode === "PRIVATE";

  useEffect(() => {
    if (isPrivate) return;
    navigate({
      to: "/spaces/$spaceId/configuration",
      params: { spaceId },
      replace: true,
    });
  }, [isPrivate, navigate, spaceId]);

  if (!isPrivate) return null;
  return <>{children}</>;
}
