import { createFileRoute } from "@tanstack/react-router";
import { ComputerWorkbench } from "@/components/computer/ComputerWorkbench";

export const Route = createFileRoute("/_authed/_shell/threads/")({
  component: NewThreadPage,
});

function NewThreadPage() {
  return <ComputerWorkbench />;
}
