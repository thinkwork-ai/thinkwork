import { createFileRoute } from "@tanstack/react-router";
import { ComputerWorkbench } from "@/components/computer/ComputerWorkbench";

export const Route = createFileRoute("/_authed/_shell/computer")({
  component: ComputerPage,
});

function ComputerPage() {
  return <ComputerWorkbench />;
}
