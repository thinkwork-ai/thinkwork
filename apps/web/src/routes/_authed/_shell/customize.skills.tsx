import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { useSkillItems } from "@/components/customize/use-customize-data";
import { useSkillMutation } from "@/components/customize/use-customize-mutations";

export const Route = createFileRoute("/_authed/_shell/customize/skills")({
  component: SkillsTab,
});

function SkillsTab() {
  const { items, fetching, error } = useSkillItems();
  const { toggle } = useSkillMutation();

  const handleAction = useCallback(
    (skillId: string, nextConnected: boolean) => {
      void toggle(skillId, nextConnected);
    },
    [toggle],
  );

  return (
    <CustomizeTabBody
      activeTab="/customize/skills"
      items={items}
      onAction={handleAction}
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
