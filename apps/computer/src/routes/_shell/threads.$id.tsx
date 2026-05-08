import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_shell/threads/$id")({
  component: ThreadDetailPage,
});

function ThreadDetailPage() {
  const { id } = Route.useParams();
  return (
    <PlaceholderPage
      title={`Thread ${id}`}
      subtitle="The chat UI lands in the next phase. For now this is a placeholder — clicking a thread row in the sidebar lands you here."
    />
  );
}
