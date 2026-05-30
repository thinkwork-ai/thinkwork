import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { EvalTestCaseForm } from "@/components/settings/EvalTestCaseForm";
import { SettingsPane } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute(
  "/_authed/settings/evaluations/studio/new",
)({
  component: () => (
    <OperatorGuard>
      <NewEvalTestCasePage />
    </OperatorGuard>
  ),
});

function NewEvalTestCasePage() {
  const [actions, setActions] = useState<ReactNode>(null);
  const [actionsKey, setActionsKey] = useState(0);
  const handleActions = useCallback((node: ReactNode) => {
    setActions(node);
    setActionsKey((k) => k + 1);
  }, []);

  usePageHeaderActions({
    title: "New Test Case",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Studio", href: "/settings/evaluations/studio" },
      { label: "New Test Case" },
    ],
    action: actions ?? undefined,
    actionKey: `eval-new:${actionsKey}`,
  });

  return (
    <SettingsPane className="max-w-3xl">
      <EvalTestCaseForm onActions={handleActions} />
    </SettingsPane>
  );
}
