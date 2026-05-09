import { createFileRoute } from "@tanstack/react-router";
import { AppsGallery } from "@/components/apps/AppsGallery";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";

export const Route = createFileRoute("/_authed/_shell/apps/")({
  component: AppsPage,
});

function AppsPage() {
  useBreadcrumbs([{ label: "Apps" }]);
  return <AppsGallery />;
}
