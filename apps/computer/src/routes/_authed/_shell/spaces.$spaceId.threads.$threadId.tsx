import { createFileRoute } from "@tanstack/react-router";
import { ComputerThreadDetailRoute } from "@/components/computer/ComputerThreadDetailRoute";

export const Route = createFileRoute(
  "/_authed/_shell/spaces/$spaceId/threads/$threadId",
)({
  component: SpaceThreadDetailPage,
});

function SpaceThreadDetailPage() {
  const { threadId } = Route.useParams();
  return <ComputerThreadDetailRoute threadId={threadId} />;
}
