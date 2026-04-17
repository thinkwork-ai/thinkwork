import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "urql";

import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EvalTestCaseForm } from "@/components/evaluations/EvalTestCaseForm";
import { EvalTestCaseQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/evaluations/studio/edit/$testCaseId")({
  component: EditEvalTestCasePage,
});

function EditEvalTestCasePage() {
  const { testCaseId } = Route.useParams();
  const [tc] = useQuery({ query: EvalTestCaseQuery, variables: { id: testCaseId }, pause: !testCaseId });
  const [actions, setActions] = useState<React.ReactNode>(null);

  useBreadcrumbs([
    { label: "Evaluations", href: "/evaluations" },
    { label: "Studio", href: "/evaluations/studio" },
    { label: tc.data?.evalTestCase?.name ?? "Edit" },
  ]);

  if (tc.fetching || !tc.data) return <PageSkeleton />;
  const initial = tc.data.evalTestCase;
  if (!initial) return <div className="p-6">Test case not found.</div>;

  return (
    <PageLayout header={<PageHeader title={`Edit: ${initial.name}`} actions={actions} />}>
      <EvalTestCaseForm initial={initial as any} isEdit onActions={setActions} />
    </PageLayout>
  );
}
