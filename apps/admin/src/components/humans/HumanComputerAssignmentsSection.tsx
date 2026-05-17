import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Loader2, Monitor, Save } from "lucide-react";
import {
  ComputersListQuery,
  SetUserComputerAssignmentsMutation,
  UserComputerAssignmentsQuery,
} from "@/lib/graphql-queries";
import { accessSourceLabel } from "@/lib/computer-assignment-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ComputerStatus } from "@/gql/graphql";

interface HumanComputerAssignmentsSectionProps {
  userId: string;
  tenantId: string;
}

type ComputerAccessRow = {
  id: string;
  name: string;
  slug: string;
  templateName: string | null;
  accessSource: string | null;
  teams: string[];
};

export function HumanComputerAssignmentsSection({
  userId,
  tenantId,
}: HumanComputerAssignmentsSectionProps) {
  const [selectedComputerIds, setSelectedComputerIds] = useState<string[]>([]);
  const [assignmentsResult, reexecuteAssignments] = useQuery({
    query: UserComputerAssignmentsQuery,
    variables: { userId },
    requestPolicy: "cache-and-network",
  });
  const [computersResult] = useQuery({
    query: ComputersListQuery,
    variables: { tenantId },
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: saving }, setUserAssignments] = useMutation(
    SetUserComputerAssignmentsMutation,
  );

  const assignments = assignmentsResult.data?.userComputerAssignments ?? [];
  const serverDirectComputerIds = useMemo(
    () =>
      assignments
        .filter((assignment) => assignment.directAssignment)
        .map((assignment) => assignment.computerId),
    [assignments],
  );

  useEffect(() => {
    if (!assignmentsResult.data) return;
    setSelectedComputerIds(serverDirectComputerIds);
  }, [assignmentsResult.data, serverDirectComputerIds]);

  const rows: ComputerAccessRow[] = useMemo(() => {
    const assignmentByComputer = new Map(
      assignments.map((assignment) => [assignment.computerId, assignment]),
    );
    const computers = computersResult.data?.computers ?? [];
    const activeComputers = computers.filter(
      (computer) => computer.status !== ComputerStatus.Archived,
    );
    const combined = new Map<string, ComputerAccessRow>();

    for (const computer of activeComputers) {
      const assignment = assignmentByComputer.get(computer.id);
      combined.set(computer.id, {
        id: computer.id,
        name: computer.name,
        slug: computer.slug,
        templateName: computer.template?.name ?? null,
        accessSource: assignment?.accessSource ?? null,
        teams: assignment?.teams.map((team) => team.name) ?? [],
      });
    }

    for (const assignment of assignments) {
      if (combined.has(assignment.computerId)) continue;
      combined.set(assignment.computerId, {
        id: assignment.computer.id,
        name: assignment.computer.name,
        slug: assignment.computer.slug,
        templateName: assignment.computer.template?.name ?? null,
        accessSource: assignment.accessSource,
        teams: assignment.teams.map((team) => team.name),
      });
    }

    return [...combined.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, computersResult.data]);

  const loading =
    (assignmentsResult.fetching && !assignmentsResult.data) ||
    (computersResult.fetching && !computersResult.data);
  const dirty = !sameSet(selectedComputerIds, serverDirectComputerIds);

  async function saveAssignments() {
    const result = await setUserAssignments({
      input: {
        userId,
        computerIds: selectedComputerIds,
      },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Computer assignments updated");
    reexecuteAssignments({ requestPolicy: "network-only" });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-cyan-600" />
              Computers
            </CardTitle>
            <CardDescription>
              Shared Computers this person can message and use.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={saveAssignments}
            disabled={!dirty || saving || loading}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {assignmentsResult.error || computersResult.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {assignmentsResult.error?.message ?? computersResult.error?.message}
          </div>
        ) : null}
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
          {rows.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {loading ? "Loading Computers..." : "No Computers"}
            </div>
          ) : (
            rows.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-start gap-3 rounded px-2 py-2 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={selectedComputerIds.includes(row.id)}
                  disabled={saving || loading}
                  onCheckedChange={(checked) =>
                    toggleSelection(row.id, checked === true)
                  }
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{row.name}</span>
                    {row.accessSource ? (
                      <Badge variant="outline" className="text-xs">
                        {accessSourceLabel(row.accessSource)}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {row.templateName ?? row.slug}
                  </span>
                  {row.teams.length > 0 ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.teams.map((team) => (
                        <Badge
                          key={team}
                          variant="secondary"
                          className="text-xs"
                        >
                          {team}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );

  function toggleSelection(id: string, checked: boolean) {
    setSelectedComputerIds((current) => {
      if (checked) return current.includes(id) ? current : [...current, id];
      return current.filter((value) => value !== id);
    });
  }
}

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
