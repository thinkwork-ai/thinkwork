import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

import { useTenant } from "@/context/TenantContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  EvalTestCasesQuery,
  CreateEvalTestCaseMutation,
  DeleteEvalTestCaseMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

// 16 built-in evaluators pre-provisioned by AWS Bedrock AgentCore. Source:
// `aws bedrock-agentcore-control list-evaluators`. Custom evaluators (e.g.
// our deterministic-assertions Lambda) can be added later as ARNs.
const BUILTIN_EVALUATORS = [
  { id: "Builtin.Helpfulness", level: "TRACE" },
  { id: "Builtin.Correctness", level: "TRACE" },
  { id: "Builtin.Faithfulness", level: "TRACE" },
  { id: "Builtin.ResponseRelevance", level: "TRACE" },
  { id: "Builtin.Conciseness", level: "TRACE" },
  { id: "Builtin.Coherence", level: "TRACE" },
  { id: "Builtin.InstructionFollowing", level: "TRACE" },
  { id: "Builtin.Refusal", level: "TRACE" },
  { id: "Builtin.Harmfulness", level: "TRACE" },
  { id: "Builtin.Stereotyping", level: "TRACE" },
  { id: "Builtin.ToolSelectionAccuracy", level: "TOOL_CALL" },
  { id: "Builtin.ToolParameterAccuracy", level: "TOOL_CALL" },
  { id: "Builtin.GoalSuccessRate", level: "SESSION" },
  { id: "Builtin.TrajectoryExactOrderMatch", level: "SESSION" },
  { id: "Builtin.TrajectoryInOrderMatch", level: "SESSION" },
  { id: "Builtin.TrajectoryAnyOrderMatch", level: "SESSION" },
];

export const Route = createFileRoute("/_authed/_tenant/evaluations/studio/")({
  component: EvalStudioPage,
});

function EvalStudioPage() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");

  const [cases, refetch] = useQuery({
    query: EvalTestCasesQuery,
    variables: { tenantId, search: search || null },
    pause: !tenantId,
  });
  const [, deleteCase] = useMutation(DeleteEvalTestCaseMutation);

  if (!tenantId) return <PageSkeleton />;
  const items = cases.data?.evalTestCases ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Eval Studio"
        description={`${items.length} test cases`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/evaluations">
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Link>
            </Button>
            <CreateTestCaseDialog tenantId={tenantId} onCreated={() => refetch({ requestPolicy: "network-only" })} />
          </div>
        }
      />

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
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No test cases. Click "New test case" to add one.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((tc: any) => {
                  let assertionCount = 0;
                  try { assertionCount = JSON.parse(tc.assertions || "[]").length; } catch {}
                  return (
                    <TableRow key={tc.id}>
                      <TableCell className="font-medium">{tc.name}</TableCell>
                      <TableCell><Badge variant="outline">{tc.category}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {tc.agentcoreEvaluatorIds?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{assertionCount}</TableCell>
                      <TableCell>
                        <Badge variant={tc.enabled ? "default" : "secondary"}>
                          {tc.enabled ? "on" : "off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{relativeTime(tc.updatedAt)}</TableCell>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog (inline for v1 — extract to its own file when it grows)
// ---------------------------------------------------------------------------

function CreateTestCaseDialog({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("smoke");
  const [query, setQuery] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [assertContains, setAssertContains] = useState("");
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>(["Builtin.Helpfulness"]);
  const [enabled, setEnabled] = useState(true);
  const [, createCase] = useMutation(CreateEvalTestCaseMutation);
  const [submitting, setSubmitting] = useState(false);

  function toggleEval(id: string) {
    setEvaluatorIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  async function handleCreate() {
    setSubmitting(true);
    try {
      const assertions = assertContains.trim()
        ? assertContains.split("\n").map((line) => ({ type: "contains", value: line.trim() })).filter((a) => a.value)
        : [];
      await createCase({
        tenantId,
        input: {
          name,
          category,
          query,
          systemPrompt: systemPrompt || null,
          assertions,
          agentcoreEvaluatorIds: evaluatorIds,
          enabled,
        },
      });
      onCreated();
      setOpen(false);
      setName(""); setCategory("smoke"); setQuery(""); setSystemPrompt(""); setAssertContains("");
      setEvaluatorIds(["Builtin.Helpfulness"]);
      setEnabled(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> New test case
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New test case</DialogTitle>
          <DialogDescription>
            Author a test that the agent under test will run during evaluations.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="category">Category</Label>
              <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="query">User prompt</Label>
            <Textarea id="query" rows={3} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="system">System prompt (optional)</Label>
            <Textarea id="system" rows={2} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assertions">Contains assertions (one per line, optional)</Label>
            <Textarea id="assertions" rows={2} placeholder="pong" value={assertContains} onChange={(e) => setAssertContains(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Each line becomes a deterministic <code>contains</code> check on the agent output.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label>AgentCore evaluators</Label>
            <div className="flex flex-wrap gap-2">
              {BUILTIN_EVALUATORS.map((ev) => (
                <Button
                  key={ev.id}
                  type="button"
                  variant={evaluatorIds.includes(ev.id) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleEval(ev.id)}
                >
                  {ev.id.replace("Builtin.", "")}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="enabled">Enabled (included in runs)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!name || !query || submitting}>{submitting ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
