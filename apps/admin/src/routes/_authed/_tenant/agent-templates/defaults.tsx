import { createFileRoute } from "@tanstack/react-router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/defaults",
)({
  component: DefaultWorkspacePage,
});

function DefaultWorkspacePage() {
  useBreadcrumbs([
    { label: "Templates", href: "/agent-templates" },
    { label: "Default Workspace" },
  ]);

  return (
    <PageLayout
      header={
        <div>
          <h1 className="text-lg font-semibold">Default Workspace</h1>
          <p className="text-xs text-muted-foreground">
            Default workspace files for new Computer and Agent templates
          </p>
        </div>
      }
    >
      <WorkspaceEditor target={{ defaults: true }} mode="defaults" />
    </PageLayout>
  );
}
