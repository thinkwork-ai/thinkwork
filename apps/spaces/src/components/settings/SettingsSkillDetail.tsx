import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { skillCatalogClient } from "@/lib/workspace-files-api";

export function SettingsSkillDetail() {
  const { skillSlug } = useParams({
    from: "/_authed/settings/skills/$skillSlug",
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <Link
        to="/settings/skills"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:underline"
      >
        <ArrowLeft className="size-4" />
        Skills
      </Link>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">
        {skillSlug}
      </h1>
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
