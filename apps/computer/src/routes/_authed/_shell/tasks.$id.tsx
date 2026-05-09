import { createFileRoute } from "@tanstack/react-router";
import { ComputerThreadDetailRoute } from "@/components/computer/ComputerThreadDetailRoute";

export const Route = createFileRoute("/_authed/_shell/tasks/$id")({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id } = Route.useParams();
  return <ComputerThreadDetailRoute threadId={id} />;
}
