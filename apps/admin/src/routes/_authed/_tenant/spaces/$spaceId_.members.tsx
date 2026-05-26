import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { SpaceDetailChrome } from "@/components/spaces/SpaceDetailChrome";
import { SpaceMembersPanel } from "@/components/spaces/SpaceMembersPanel";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute(
  "/_authed/_tenant/spaces/$spaceId_/members",
)({
  component: SpaceMembersRoute,
});

function SpaceMembersRoute() {
  const { spaceId } = Route.useParams();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <SpaceDetailChrome
      spaceId={spaceId}
      activeTab="members"
      headerActions={({ space }) =>
        space.accessMode === "PRIVATE" ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Add
          </Button>
        ) : null
      }
    >
      {({ space }) => (
        <MembersGuard
          spaceId={spaceId}
          accessMode={space.accessMode}
          tenantId={space.tenantId}
        >
          <SpaceMembersPanel
            spaceId={space.id}
            tenantId={space.tenantId}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
          />
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
      to: "/spaces/$spaceId/workspace",
      params: { spaceId },
      replace: true,
    });
  }, [isPrivate, navigate, spaceId]);

  if (!isPrivate) return null;
  return <>{children}</>;
}
