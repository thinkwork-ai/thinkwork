import { useParams } from "@tanstack/react-router";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { skillCatalogClient } from "@/lib/workspace-files-api";

export function SettingsSkillDetail() {
  const { skillSlug } = useParams({
    from: "/_authed/settings/skills/$skillSlug",
  });

  // Title + back navigation relocate to the settings header bar: the "Skills"
  // crumb links back to the list, and the sidebar's back button also works.
  usePageHeaderActions({
    title: skillSlug,
    breadcrumbs: [
      { label: "Skills", href: "/settings/skills" },
      { label: skillSlug },
    ],
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <WorkspaceFileEditor
        target={{ skill: skillSlug }}
        targetKey={`skill:${skillSlug}`}
        client={skillCatalogClient}
        defaultOpenFile="SKILL.md"
        className="min-h-0 flex-1"
      />
    </div>
  );
}
