import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsEvalDatasets } from "@/components/settings/SettingsEvalDatasets";

export const Route = createFileRoute("/_authed/settings/evaluations/datasets/")(
  {
    component: () => (
      <OperatorGuard>
        <SettingsEvalDatasets />
      </OperatorGuard>
    ),
  },
);
