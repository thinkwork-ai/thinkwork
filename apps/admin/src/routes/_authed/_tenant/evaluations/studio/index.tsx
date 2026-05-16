import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { Download, Plus, Trash2 } from "lucide-react";

import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EvalTestCasesQuery,
  DeleteEvalTestCaseMutation,
  SeedEvalTestCasesMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/evaluations/studio/")({
  component: EvalStudioPage,
});

function EvalStudioPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([
    { label: "Evaluations", href: "/evaluations" },
    { label: "Studio" },
  ]);
  const [search, setSearch] = useState("");

  const [cases, refetch] = useQuery({
    query: EvalTestCasesQuery,
    variables: { tenantId, search: search || null },
    pause: !tenantId,
  });
  const [, deleteCase] = useMutation(DeleteEvalTestCaseMutation);
  const [seedState, seedCases] = useMutation(SeedEvalTestCasesMutation);

  if (!tenantId) return <PageSkeleton />;
  const items = cases.data?.evalTestCases ?? [];

  return (
    <PageLayout
      header={
        <PageHeader
          title="Evaluation Studio"
          description={`${items.length} test cases`}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={seedState.fetching}
                onClick={async () => {
                  if (
                    !confirm(
                      "Import the Thinkwork RedTeam starter pack? 189 test cases across 4 categories. Re-runs are safe (skips already-imported names).",
                    )
                  )
                    return;
                  const res = await seedCases({ tenantId });
                  refetch({ requestPolicy: "network-only" });
                  if (res.error) {
                    alert(
                      `Import failed: ${res.error.message}\n\nThis usually means the seedEvalTestCases mutation hasn't been deployed yet — check the latest deploy on main.`,
                    );
                  } else if (res.data?.seedEvalTestCases === undefined) {
                    alert(
                      "Import returned no data — the deployed graphql-http likely doesn't expose seedEvalTestCases yet. Wait for the next deploy.",
                    );
                  } else {
                    alert(
                      `Imported ${res.data.seedEvalTestCases} new test case(s).`,
                    );
                  }
                }}
              >
                <Download className="mr-1 h-4 w-4" />{" "}
                {seedState.fetching ? "Importing…" : "Import starter pack"}
              </Button>
              <Button asChild size="sm">
                <Link to="/evaluations/studio/new">
                  <Plus className="mr-1 h-4 w-4" /> New test case
                </Link>
              </Button>
            </div>
          }
        />
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Test cases</span>
            <Input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Evaluators</TableHead>
                <TableHead>Assertions</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground"
                  >
                    No test cases. Click "New test case" to add one.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((tc: any) => {
                  let assertionCount = 0;
                  try {
                    assertionCount = JSON.parse(tc.assertions || "[]").length;
                  } catch {}
                  return (
                    <TableRow key={tc.id} className="h-10 max-h-10 [&>td]:py-1">
                      <TableCell className="font-medium">
                        <Link
                          to="/evaluations/studio/$testCaseId"
                          params={{ testCaseId: tc.id }}
                          className="hover:underline"
                        >
                          {tc.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{tc.category}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tc.agentcoreEvaluatorIds?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {assertionCount}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tc.enabled ? "default" : "secondary"}>
                          {tc.enabled ? "on" : "off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeTime(tc.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (!confirm(`Delete "${tc.name}"?`)) return;
                            await deleteCase({ id: tc.id });
                            refetch({ requestPolicy: "network-only" });
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
