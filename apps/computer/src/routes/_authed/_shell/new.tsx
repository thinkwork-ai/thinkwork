import { createFileRoute } from "@tanstack/react-router";
import { ComputerWorkbench } from "@/components/computer/ComputerWorkbench";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    spaceId: typeof search.spaceId === "string" ? search.spaceId : undefined,
  }),
  component: NewThreadPage,
});

function NewThreadPage() {
  const { spaceId } = Route.useSearch();
  usePageHeaderActions({ title: "New thread", hideTopBar: true });
  return <ComputerWorkbench spaceId={spaceId} />;
}
