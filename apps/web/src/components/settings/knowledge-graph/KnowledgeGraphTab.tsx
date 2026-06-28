import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { KnowledgeGraphExplorer } from "./KnowledgeGraphExplorer";

/**
 * Ontology terms as a tab of the unified Memory page. This intentionally shows
 * definitions only; the old data/graph explorer is not part of the active
 * memory path.
 */
export function KnowledgeGraphTab() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Ontology"
        description="Inspect approved ontology terms and relationship definitions."
      />
      <div className="min-h-0 flex-1">
        <KnowledgeGraphExplorer mode="definitions" />
      </div>
    </div>
  );
}
