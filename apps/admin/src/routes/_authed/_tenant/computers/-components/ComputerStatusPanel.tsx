import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "urql";
import { Archive, Loader2, Pause, Play } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UpdateComputerMutation } from "@/lib/graphql-queries";
import {
  ComputerDesiredRuntimeStatus,
  ComputerStatus,
  type Computer,
} from "@/gql/graphql";
import { formatUsd, relativeTime } from "@/lib/utils";

type ComputerStatusPanelProps = {
  computer: Pick<
    Computer,
    | "id"
    | "name"
    | "slug"
    | "status"
    | "desiredRuntimeStatus"
    | "runtimeStatus"
    | "budgetMonthlyCents"
    | "spentMonthlyCents"
    | "budgetPausedReason"
    | "lastActiveAt"
    | "updatedAt"
  >;
  onUpdated?: () => void;
};

function centsToUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return formatUsd(cents / 100, 0);
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ComputerStatusPanel({
  computer,
  onUpdated,
}: ComputerStatusPanelProps) {
  const navigate = useNavigate();
  const [{ fetching }, updateComputer] = useMutation(UpdateComputerMutation);
  const targetDesiredStatus = useMemo(
    () =>
      computer.desiredRuntimeStatus === ComputerDesiredRuntimeStatus.Running
        ? ComputerDesiredRuntimeStatus.Stopped
        : ComputerDesiredRuntimeStatus.Running,
    [computer.desiredRuntimeStatus],
  );

  const isArchived = computer.status === ComputerStatus.Archived;

  async function updateDesiredRuntimeStatus() {
    const result = await updateComputer({
      id: computer.id,
      input: { desiredRuntimeStatus: targetDesiredStatus },
    });
    if (!result.error) onUpdated?.();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Computer Status</CardTitle>
        <CardDescription>
          Desired runtime status is an operator intent field until ECS lifecycle
          controls are provisioned.
        </CardDescription>
        {/* Archive lives here per plan 2026-05-13-005 U4 — moved out of
            the page header. Run/stop toggle moves inline next to the
            Runtime badges below so it stays discoverable. */}
        <CardAction>
          {isArchived ? (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300"
            >
              <Archive className="h-3 w-3" />
              Archived
            </Badge>
          ) : (
            <ArchiveButton
              computerId={computer.id}
              computerName={computer.name}
              onArchived={() => navigate({ to: "/computers" })}
            />
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Product Status
            </dt>
            <dd className="mt-1">
              <StatusBadge status={computer.status.toLowerCase()} size="sm" />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Runtime
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">
                Desired {label(computer.desiredRuntimeStatus)}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Observed {label(computer.runtimeStatus)}
              </Badge>
              {!isArchived ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={updateDesiredRuntimeStatus}
                  disabled={fetching}
                  className="h-6 gap-1 px-2 text-xs"
                  title={`Set desired runtime to ${label(targetDesiredStatus)}`}
                >
                  {fetching ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : targetDesiredStatus ===
                    ComputerDesiredRuntimeStatus.Running ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                  {label(targetDesiredStatus)}
                </Button>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Monthly Budget
            </dt>
            <dd className="mt-1 text-sm">
              {centsToUsd(computer.spentMonthlyCents)} spent of{" "}
              {centsToUsd(computer.budgetMonthlyCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              Last Active
            </dt>
            <dd className="mt-1 text-sm">
              {computer.lastActiveAt
                ? relativeTime(computer.lastActiveAt)
                : "—"}
            </dd>
          </div>
          {computer.budgetPausedReason ? (
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-muted-foreground">
                Budget Pause Reason
              </dt>
              <dd className="mt-1 text-sm">{computer.budgetPausedReason}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function ArchiveButton({
  computerId,
  computerName,
  onArchived,
}: {
  computerId: string;
  computerName: string;
  onArchived: () => void;
}) {
  const [{ fetching }, updateComputer] = useMutation(UpdateComputerMutation);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setError(null);
    const result = await updateComputer({
      id: computerId,
      input: { status: ComputerStatus.Archived },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    onArchived();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive h-7 gap-1 px-2 text-xs"
        >
          <Archive className="h-3.5 w-3.5" />
          Archive
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this Computer?</AlertDialogTitle>
          <AlertDialogDescription>
            Archiving "{computerName}" hides it from the default Computers list
            and frees the owner's active-Computer slot, so they become eligible
            for a new Computer. Toggle "Show archived" on the list to view it
            again. This action cannot be reversed in-place — re-provisioning
            the owner creates a new Computer record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={fetching}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void archive();
            }}
            disabled={fetching}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {fetching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Archiving...
              </>
            ) : (
              "Archive"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
