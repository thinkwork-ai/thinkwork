import { useMemo } from "react";
import { useMutation } from "urql";
import { Loader2, Pause, Play } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
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
import { ComputerDesiredRuntimeStatus, type Computer } from "@/gql/graphql";
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
  const [{ fetching }, updateComputer] = useMutation(UpdateComputerMutation);
  const targetDesiredStatus = useMemo(
    () =>
      computer.desiredRuntimeStatus === ComputerDesiredRuntimeStatus.Running
        ? ComputerDesiredRuntimeStatus.Stopped
        : ComputerDesiredRuntimeStatus.Running,
    [computer.desiredRuntimeStatus],
  );

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
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            onClick={updateDesiredRuntimeStatus}
            disabled={fetching}
            title={`Set desired runtime to ${label(targetDesiredStatus)}`}
          >
            {fetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : targetDesiredStatus === ComputerDesiredRuntimeStatus.Running ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
            {label(targetDesiredStatus)}
          </Button>
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
            <dd className="mt-1 flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">
                Desired {label(computer.desiredRuntimeStatus)}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Observed {label(computer.runtimeStatus)}
              </Badge>
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
