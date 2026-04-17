import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EvalTestCaseForm } from "@/components/evaluations/EvalTestCaseForm";

export const Route = createFileRoute("/_authed/_tenant/evaluations/studio/new")({
  component: NewEvalTestCasePage,
});

function NewEvalTestCasePage() {
  useBreadcrumbs([
    { label: "Evaluations", href: "/evaluations" },
    { label: "Studio", href: "/evaluations/studio" },
    { label: "New Test Case" },
  ]);
  const [actions, setActions] = useState<React.ReactNode>(null);

  return (
    <PageLayout header={<PageHeader title="New Test Case" actions={actions} />}>
      <EvalTestCaseForm onActions={setActions} />
    </PageLayout>
  );
}
