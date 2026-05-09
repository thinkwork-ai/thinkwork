import { createFileRoute } from "@tanstack/react-router";
import { ComputerWorkbench } from "@/components/computer/ComputerWorkbench";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";

export const Route = createFileRoute("/_authed/_shell/threads/")({
  component: NewThreadPage,
});

function NewThreadPage() {
  useBreadcrumbs([{ label: "New Thread" }]);
  return <ComputerWorkbench />;
}
