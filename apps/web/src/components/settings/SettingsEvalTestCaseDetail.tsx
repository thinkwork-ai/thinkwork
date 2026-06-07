import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  DeleteEvalTestCaseMutation,
  EvalTestCaseHistoryQuery,
  EvalTestCaseQuery,
} from "@/lib/evaluation-queries";
import { relativeTime } from "@/lib/utils";

const EVAL_RESULT_SHEET_WIDTH_CLASS = "data-[side=right]:max-w-none";
const EVAL_RESULT_SHEET_STYLE = {
  width: "min(750px, calc(100vw - 2rem))",
  maxWidth: "none",
};

interface HistoryRow {
  id: string;
  runId: string;
  testCaseName: string | null;
  category: string | null;
  status: string;
  score: number | null;
  input: string | null;
  expected: string | null;
  actualOutput: string | null;
  assertions: unknown;
  evaluatorResults: unknown;
  durationMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

function statusBadge(status: string) {
  if (status === "pass")
    return (
      <Badge className="bg-green-600 hover:bg-green-600 text-white">pass</Badge>
    );
  if (status === "fail") return <Badge variant="destructive">fail</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

const historyColumns: ColumnDef<HistoryRow>[] = [
  {
    accessorKey: "createdAt",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {relativeTime(row.original.createdAt)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 80,
    cell: ({ row }) => statusBadge(row.original.status),
  },
  {
    accessorKey: "score",
    header: "Score",
    size: 80,
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.score != null
          ? Number(row.original.score).toFixed(2)
          : "—"}
      </span>
    ),
  },
  {
    accessorKey: "durationMs",
    header: "Duration",
    size: 100,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">
        {row.original.durationMs != null ? `${row.original.durationMs}ms` : "—"}
      </span>
    ),
  },
  {
    accessorKey: "actualOutput",
    header: "Output",
    cell: ({ row }) => (
      <p className="text-sm text-muted-foreground truncate max-w-[400px]">
        {row.original.actualOutput ?? "—"}
      </p>
    ),
  },
];

export function SettingsEvalTestCaseDetail() {
  const { testCaseId } = useParams({
    from: "/_authed/settings/evaluations/studio/$testCaseId",
  });
  const navigate = useNavigate();
  const [selectedResult, setSelectedResult] = useState<HistoryRow | null>(null);

  const [tcResult] = useQuery({
    query: EvalTestCaseQuery,
    variables: { id: testCaseId },
  });
  const [historyResult] = useQuery({
    query: EvalTestCaseHistoryQuery,
    variables: { testCaseId, limit: 50 },
  });
  const [, deleteTestCase] = useMutation(DeleteEvalTestCaseMutation);

  const tc = tcResult.data?.evalTestCase;
  const history = (historyResult.data?.evalTestCaseHistory ??
    []) as unknown as HistoryRow[];

  const parseJson = (val: unknown, fallback: unknown[] = []): unknown[] => {
    if (val == null) return fallback;
    let p: unknown = val;
    while (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch {
        return fallback;
      }
    }
    return Array.isArray(p) ? p : fallback;
  };

  const assertions = useMemo(
    () => parseJson(tc?.assertions) as Array<{ type?: string; value?: string }>,
    [tc],
  );
  const evaluators = useMemo(
    () => (tc?.agentcoreEvaluatorIds ?? []) as string[],
    [tc],
  );
  const tags = useMemo(() => (tc?.tags ?? []) as string[], [tc]);

  usePageHeaderActions({
    title: tc?.name ?? "Test Case",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Studio", href: "/settings/evaluations/studio" },
      { label: tc?.name ?? "Test Case" },
    ],
    action: tc ? (
      <div className="flex items-center gap-2">
        <Badge variant={tc.enabled ? "default" : "secondary"}>
          {tc.enabled ? "Enabled" : "Disabled"}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({
              to: "/settings/evaluations/studio/edit/$testCaseId",
              params: { testCaseId },
            })
          }
        >
          <Pencil className="h-4 w-4 mr-1" />
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete test case?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this test case and cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    ) : undefined,
    actionKey: `eval-tc:${testCaseId}:${tc?.enabled ? "on" : "off"}`,
  });

  if (tcResult.fetching && !tc) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (!tc) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">Test case not found.</p>
      </div>
    );
  }

  async function handleDelete() {
    const res = await deleteTestCase({ id: testCaseId });
    if (res.error) toast.error("Delete failed: " + res.error.message);
    else {
      toast.success("Test case deleted");
      navigate({ to: "/settings/evaluations/studio" });
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[750px] space-y-6 px-6 pb-10 pt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Test Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Query
              </label>
              <p className="mt-1 text-sm bg-muted/50 p-3 rounded-md font-mono whitespace-pre-wrap">
                {tc.query}
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Assertions ({assertions.length})
              </label>
              <div className="mt-1 space-y-2">
                {assertions.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 bg-muted/50 p-2 rounded-md"
                  >
                    <Badge
                      variant="outline"
                      className="text-xs shrink-0 mt-0.5"
                    >
                      {a.type ?? "?"}
                    </Badge>
                    <span className="text-sm">{a.value ?? "—"}</span>
                  </div>
                ))}
              </div>
            </div>

            {evaluators.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  AgentCore Evaluators
                </label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {evaluators.map((ev) => (
                    <Badge key={ev} variant="outline" className="text-xs">
                      {ev.replace("Builtin.", "")}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Tags
                </label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <h3 className="text-sm font-semibold mb-3">Run History</h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No results yet. Run an evaluation that includes this test case.
            </p>
          ) : (
            <DataTable
              columns={historyColumns}
              data={history}
              onRowClick={(row) => setSelectedResult(row)}
              pageSize={20}
            />
          )}
        </div>
      </div>

      <Sheet
        open={!!selectedResult}
        onOpenChange={() => setSelectedResult(null)}
      >
        <SheetContent
          className={`${EVAL_RESULT_SHEET_WIDTH_CLASS} overflow-y-auto`}
          style={EVAL_RESULT_SHEET_STYLE}
        >
          <SheetHeader className="px-6 pt-6">
            <SheetTitle className="text-base leading-snug">
              {selectedResult?.testCaseName ?? tc.name}
            </SheetTitle>
          </SheetHeader>
          {selectedResult && (
            <div className="space-y-4 px-6 pb-6">
              <div className="flex items-center gap-2">
                {statusBadge(selectedResult.status)}
                <Badge variant="outline">{tc.category}</Badge>
                {selectedResult.score != null && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Score: {Number(selectedResult.score).toFixed(2)}
                  </span>
                )}
                {selectedResult.durationMs != null && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {selectedResult.durationMs}ms
                  </span>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Input</h4>
                <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                  {selectedResult.input ?? tc.query}
                </pre>
              </div>

              {selectedResult.expected && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Expected</h4>
                  <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                    {selectedResult.expected}
                  </pre>
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium mb-1">Actual Output</h4>
                <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-96">
                  {selectedResult.actualOutput ?? "No output"}
                </pre>
              </div>

              {selectedResult.assertions != null &&
                (() => {
                  try {
                    const raw = selectedResult.assertions as unknown;
                    const parsed =
                      typeof raw === "string" ? JSON.parse(raw) : raw;
                    return (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Assertions</h4>
                        <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(parsed, null, 2)}
                        </pre>
                      </div>
                    );
                  } catch {
                    return null;
                  }
                })()}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
