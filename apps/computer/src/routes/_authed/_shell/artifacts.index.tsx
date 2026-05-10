import { createFileRoute } from "@tanstack/react-router";
import {
  ArtifactsCreateAction,
  ArtifactsListBody,
} from "@/components/artifacts/ArtifactsListBody";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/artifacts/")({
  component: ArtifactsPage,
});

function ArtifactsPage() {
  usePageHeaderActions({
    title: "Artifacts",
    action: <ArtifactsCreateAction />,
    actionKey: "artifacts-create",
  });
  return <ArtifactsListBody />;
}
