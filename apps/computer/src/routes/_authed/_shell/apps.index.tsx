import { createFileRoute } from "@tanstack/react-router";
import { AppsGallery } from "@/components/apps/AppsGallery";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/apps/")({
  component: AppsPage,
});

function AppsPage() {
  usePageHeaderActions({ title: "Apps" });
  return <AppsGallery />;
}
