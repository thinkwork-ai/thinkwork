import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { SKILLS_FIXTURE } from "@/components/customize/customize-fixtures";

export const Route = createFileRoute("/_authed/_shell/customize/skills")({
  component: SkillsTab,
});

/**
 * v1 renders a fixture catalog. U5 swaps the fixture for real urql
 * queries against tenant_skills + the caller's agent_skills bindings.
 */
function SkillsTab() {
  return (
    <CustomizeTabBody
      activeTab="/customize/skills"
      items={SKILLS_FIXTURE}
      searchPlaceholder="Search skills…"
      emptyMessage="No skills match your filters."
    />
  );
}
