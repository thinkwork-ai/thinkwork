import { createFileRoute } from "@tanstack/react-router";
import { AppsGallery } from "@/components/apps/AppsGallery";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/artifacts/")({
  component: ArtifactsPage,
});

function ArtifactsPage() {
  usePageHeaderActions({ title: "Artifacts" });
  return <AppsGallery />;
}
