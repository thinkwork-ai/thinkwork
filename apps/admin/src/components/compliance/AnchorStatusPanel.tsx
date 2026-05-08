import { CheckCircle, Clock } from "lucide-react";
import { ComplianceAnchorState, type ComplianceAnchorStatus } from "@/gql/graphql";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyableRow } from "@/components/ui/copyable-row";
import { formatDateTime, relativeTime } from "@/lib/utils";

export interface AnchorStatusPanelProps {
  anchorStatus: Pick<
    ComplianceAnchorStatus,
    "state" | "cadenceId" | "anchoredRecordedAt" | "nextCadenceWithinMinutes"
  >;
}

export function AnchorStatusPanel({ anchorStatus }: AnchorStatusPanelProps) {
  if (anchorStatus.state === ComplianceAnchorState.Anchored) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle className="size-4 text-emerald-600" />
            Anchor status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
            <CheckCircle className="size-3.5" />
            Anchored
          </Badge>
          {anchorStatus.cadenceId ? (
            <CopyableRow
              label="Cadence"
              value={anchorStatus.cadenceId}
            />
          ) : null}
          {anchorStatus.anchoredRecordedAt ? (
            <div className="flex items-center justify-between text-sm gap-4">
              <span className="text-muted-foreground shrink-0">Anchored</span>
              <span title={formatDateTime(anchorStatus.anchoredRecordedAt)}>
                {relativeTime(anchorStatus.anchoredRecordedAt)}
              </span>
            </div>
          ) : null}
          {anchorStatus.cadenceId ? (
            <p className="text-xs text-muted-foreground">
              Recorded within anchored window {anchorStatus.cadenceId}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-amber-600" />
          Anchor status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300">
          <Clock className="size-3.5" />
          Pending
        </Badge>
        <p className="text-xs text-muted-foreground">
          Will be anchored at the next 15-minute cadence.
        </p>
      </CardContent>
    </Card>
  );
}
