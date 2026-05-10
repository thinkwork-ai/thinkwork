import { createFileRoute } from "@tanstack/react-router";
import { AguiThreadCanvasRoute } from "@/components/computer-agui/AguiThreadCanvasRoute";

export const Route = createFileRoute("/_authed/_shell/agui/threads/$id")({
  component: AguiThreadCanvasPage,
});

function AguiThreadCanvasPage() {
  const { id } = Route.useParams();
  return <AguiThreadCanvasRoute threadId={id} />;
}
