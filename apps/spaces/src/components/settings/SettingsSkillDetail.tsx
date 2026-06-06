import { useParams } from "@tanstack/react-router";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { skillCatalogClient } from "@/lib/workspace-files-api";

export function SettingsSkillDetail() {
  const { skillSlug } = useParams({
    from: "/_authed/settings/skills/$skillSlug",
  });

  // Title + back navigation relocate to the settings header bar: the "Skill
  // Library" crumb links back to the list, and the sidebar's back button also works.
  usePageHeaderActions({
    title: skillSlug,
    breadcrumbs: [
      { label: "Skill Library", href: "/settings/skills" },
      { label: skillSlug },
    ],
  });

  return (
    <WorkspaceFileEditor
      target={{ skill: skillSlug }}
      targetKey={`skill:${skillSlug}`}
      client={skillCatalogClient}
      defaultOpenFile="SKILL.md"
      bordered={false}
      className="h-full"
      loadingSlot={<LoadingShimmer />}
    />
  );
}
