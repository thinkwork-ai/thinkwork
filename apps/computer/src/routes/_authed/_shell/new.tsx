import { createFileRoute } from "@tanstack/react-router";
import { ComputerWorkbench } from "@/components/computer/ComputerWorkbench";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/new")({
  component: NewThreadPage,
});

function NewThreadPage() {
  usePageHeaderActions({ title: "New thread", hideTopBar: true });
  return <ComputerWorkbench />;
}
