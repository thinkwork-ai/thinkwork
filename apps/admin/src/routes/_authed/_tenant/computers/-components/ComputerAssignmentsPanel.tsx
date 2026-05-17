import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Loader2, Save, Users } from "lucide-react";
import {
  ComputerAssignmentsQuery,
  SetComputerAssignmentsMutation,
  TeamsListQuery,
  TenantMembersListQuery,
} from "@/lib/graphql-queries";
import { buildComputerAssignmentTargets } from "@/lib/computer-assignment-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ComputerAssignmentSubjectType } from "@/gql/graphql";

interface ComputerAssignmentsPanelProps {
  computerId: string;
  tenantId: string;
  onUpdated?: () => void;
}

export function ComputerAssignmentsPanel({
  computerId,
  tenantId,
  onUpdated,
}: ComputerAssignmentsPanelProps) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);

  const [assignmentsResult, reexecuteAssignments] = useQuery({
    query: ComputerAssignmentsQuery,
    variables: { computerId },
    requestPolicy: "cache-and-network",
  });
  const [membersResult] = useQuery({
    query: TenantMembersListQuery,
    variables: { tenantId },
    requestPolicy: "cache-and-network",
  });
  const [teamsResult] = useQuery({
    query: TeamsListQuery,
    variables: { tenantId },
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: saving }, setAssignments] = useMutation(
    SetComputerAssignmentsMutation,
  );

  const assignments = assignmentsResult.data?.computerAssignments ?? [];

  const serverUserIds = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            assignment.subjectType === ComputerAssignmentSubjectType.User &&
            assignment.userId,
        )
        .map((assignment) => assignment.userId!),
    [assignments],
  );
  const serverTeamIds = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            assignment.subjectType === ComputerAssignmentSubjectType.Team &&
            assignment.teamId,
        )
        .map((assignment) => assignment.teamId!),
    [assignments],
  );

  useEffect(() => {
    if (!assignmentsResult.data) return;
    setSelectedUserIds(serverUserIds);
    setSelectedTeamIds(serverTeamIds);
  }, [assignmentsResult.data, serverUserIds, serverTeamIds]);

  const users = useMemo(
    () =>
      (membersResult.data?.tenantMembers ?? [])
        .filter((member) => member.principalType.toUpperCase() === "USER")
        .filter((member) => member.user)
        .map((member) => ({
          id: member.user!.id,
          name: member.user!.name ?? member.user!.email ?? member.user!.id,
          email: member.user!.email ?? "",
        })),
    [membersResult.data],
  );
  const teams = (teamsResult.data?.teams ?? []).map((team) => ({
    id: team.id,
    name: team.name,
  }));

  const dirty =
    !sameSet(selectedUserIds, serverUserIds) ||
    !sameSet(selectedTeamIds, serverTeamIds);
  const loading =
    (assignmentsResult.fetching && !assignmentsResult.data) ||
    (membersResult.fetching && !membersResult.data) ||
    (teamsResult.fetching && !teamsResult.data);

  async function saveAssignments() {
    const result = await setAssignments({
      input: {
        computerId,
        assignments: buildComputerAssignmentTargets(
          selectedUserIds,
          selectedTeamIds,
        ),
      },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success("Computer access updated");
    reexecuteAssignments({ requestPolicy: "network-only" });
    onUpdated?.();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-600" />
              Assignments
            </CardTitle>
            <CardDescription>
              Direct users and Teams that can message this shared Computer.
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
      <CardContent className="space-y-4">
        {assignmentsResult.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {assignmentsResult.error.message}
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <AssignmentList
            title="Users"
            emptyLabel={loading ? "Loading users..." : "No users"}
            items={users}
            selectedIds={selectedUserIds}
            disabled={saving || loading}
            onToggle={(id, checked) =>
              toggleSelection(setSelectedUserIds, id, checked)
            }
          />
          <AssignmentList
            title="Teams"
            emptyLabel={loading ? "Loading Teams..." : "No Teams"}
            items={teams}
            selectedIds={selectedTeamIds}
            disabled={saving || loading}
            onToggle={(id, checked) =>
              toggleSelection(setSelectedTeamIds, id, checked)
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

function AssignmentList({
  title,
  emptyLabel,
  items,
  selectedIds,
  disabled,
  onToggle,
}: {
  title: string;
  emptyLabel: string;
  items: { id: string; name: string; email?: string }[];
  selectedIds: string[];
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2">
        {items.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          items.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={selectedIds.includes(item.id)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onToggle(item.id, checked === true)
                }
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block truncate">{item.name}</span>
                {item.email && item.email !== item.name ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.email}
                  </span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function toggleSelection(
  setSelected: Dispatch<SetStateAction<string[]>>,
  id: string,
  checked: boolean,
) {
  setSelected((current) => {
    if (checked) return current.includes(id) ? current : [...current, id];
    return current.filter((value) => value !== id);
  });
}

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}
