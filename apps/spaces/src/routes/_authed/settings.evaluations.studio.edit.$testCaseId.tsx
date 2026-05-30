import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { useQuery } from "urql";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import {
  EvalTestCaseForm,
  type EvalTestCaseFormInitial,
} from "@/components/settings/EvalTestCaseForm";
import { SettingsPane } from "@/components/settings/SettingsContent";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { EvalTestCaseQuery } from "@/lib/evaluation-queries";

export const Route = createFileRoute(
  "/_authed/settings/evaluations/studio/edit/$testCaseId",
)({
  component: () => (
    <OperatorGuard>
      <EditEvalTestCasePage />
    </OperatorGuard>
  ),
});

function EditEvalTestCasePage() {
  const { testCaseId } = Route.useParams();
  const [tc] = useQuery({
    query: EvalTestCaseQuery,
    variables: { id: testCaseId },
    pause: !testCaseId,
  });
  const [actions, setActions] = useState<ReactNode>(null);
  const [actionsKey, setActionsKey] = useState(0);
  const handleActions = useCallback((node: ReactNode) => {
    setActions(node);
    setActionsKey((k) => k + 1);
  }, []);

  const initial = tc.data?.evalTestCase;

  usePageHeaderActions({
    title: initial?.name ? `Edit: ${initial.name}` : "Edit",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Studio", href: "/settings/evaluations/studio" },
      { label: initial?.name ?? "Edit" },
    ],
    action: actions ?? undefined,
    actionKey: `eval-edit:${testCaseId}:${actionsKey}`,
  });

  if (tc.fetching && !tc.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (!initial) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">Test case not found.</p>
      </div>
    );
  }

  return (
    <SettingsPane className="max-w-3xl">
      <EvalTestCaseForm
        initial={initial as unknown as EvalTestCaseFormInitial}
        isEdit
        onActions={handleActions}
      />
    </SettingsPane>
  );
}
