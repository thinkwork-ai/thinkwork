import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_shell/computer")({
  component: ComputerPage,
});

function ComputerPage() {
  return (
    <PlaceholderPage
      title="Your Computer"
      subtitle="The persistent AI work surface for your account. Real workspace, files, and tools land in the next phase — auth wiring + GraphQL + the Strands runtime connection."
    />
  );
}
