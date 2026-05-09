import { createFileRoute } from "@tanstack/react-router";
import { ComputerThreadDetailRoute } from "@/components/computer/ComputerThreadDetailRoute";

export const Route = createFileRoute("/_authed/_shell/threads/$id")({
  component: ThreadDetailPage,
});

function ThreadDetailPage() {
  const { id } = Route.useParams();
  return <ComputerThreadDetailRoute threadId={id} />;
}
