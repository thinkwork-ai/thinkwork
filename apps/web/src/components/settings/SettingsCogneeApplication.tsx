import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { ManagedApplicationLifecycleActions } from "@/components/settings/managed-applications/ManagedApplicationLifecycleActions";
import { KnowledgeGraphConfigPanel } from "./knowledge-graph/KnowledgeGraphConfigPanel";

/**
 * The Cognee managed application's deployment/config surface. This is the panel
 * that used to live behind the Knowledge Graph "Info" toggle; it now stands on
 * its own under Applications > Cognee. The graph/data explorer lives in the
 * combined Memory page instead.
 */
export function SettingsCogneeApplication() {
  usePageHeaderActions({
    title: "Cognee",
    breadcrumbs: [
      { label: "Applications", href: "/settings/managed-applications" },
      { label: "Cognee" },
    ],
    action: <ManagedApplicationLifecycleActions appKey="cognee" />,
    actionKey: "cognee-application:lifecycle",
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Cognee"
        description="Cognee infrastructure for ontology and graph retrieval."
      />
      <div className="min-h-0 flex-1">
        <KnowledgeGraphConfigPanel />
      </div>
    </div>
  );
}
