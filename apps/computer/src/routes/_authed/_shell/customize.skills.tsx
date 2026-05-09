import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { useSkillItems } from "@/components/customize/use-customize-data";

export const Route = createFileRoute("/_authed/_shell/customize/skills")({
  component: SkillsTab,
});

function SkillsTab() {
  const { items, fetching, error } = useSkillItems();
  return (
    <CustomizeTabBody
      activeTab="/customize/skills"
      items={items}
      searchPlaceholder="Search skills…"
      emptyMessage={
        error
          ? `Couldn't load skills: ${error.message}`
          : fetching
            ? "Loading skills…"
            : "No skills match your filters."
      }
    />
  );
}
