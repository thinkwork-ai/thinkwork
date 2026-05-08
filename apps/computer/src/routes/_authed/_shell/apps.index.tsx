import { createFileRoute } from "@tanstack/react-router";
import { AppsGallery } from "@/components/apps/AppsGallery";

export const Route = createFileRoute("/_authed/_shell/apps/")({
  component: AppsPage,
});

function AppsPage() {
  return <AppsGallery />;
}
