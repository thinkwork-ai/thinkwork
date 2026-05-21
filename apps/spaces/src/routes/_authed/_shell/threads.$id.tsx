import { createFileRoute } from "@tanstack/react-router";
import { SpacesThreadDetailRoute } from "@/components/workbench/SpacesThreadDetailRoute";

export const Route = createFileRoute("/_authed/_shell/threads/$id")({
  component: ThreadDetailPage,
});

function ThreadDetailPage() {
  const { id } = Route.useParams();
  return <SpacesThreadDetailRoute threadId={id} />;
}
