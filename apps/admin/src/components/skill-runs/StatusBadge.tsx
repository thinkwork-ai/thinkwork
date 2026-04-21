/**
 * StatusBadge — renders a skill_runs.status value with stable visual language.
 *
 * Covers all seven statuses the audit table can hold (see the CHECK constraint
 * on skill_runs.status):
 *   running                  — composition in flight
 *   complete                 — terminal success
 *   failed                   — terminal, check failure_reason
 *   cancelled                — terminal, user cancelled mid-run
 *   invoker_deprovisioned    — scheduled job paused because invoker left
 *   skipped_disabled         — scheduled job fired but skill was disabled
 *   cost_bounded_error       — composition aborted by a budget cap
 *
 * Labels are UI-mapped (not stored) so we can rename without a migration.
 */

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  running: "running",
  complete: "complete",
  failed: "failed",
  cancelled: "cancelled",
  invoker_deprovisioned: "paused",
  skipped_disabled: "skipped",
  cost_bounded_error: "budget",
};

export function SkillRunStatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;

  switch (status) {
    case "running":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {label}
        </Badge>
      );
    case "complete":
      return (
        <Badge className="bg-green-600 hover:bg-green-600 text-white">
          {label}
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">{label}</Badge>;
    case "cancelled":
      return <Badge variant="secondary">{label}</Badge>;
    case "invoker_deprovisioned":
      return (
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-600"
        >
          {label}
        </Badge>
      );
    case "skipped_disabled":
      return <Badge variant="secondary">{label}</Badge>;
    case "cost_bounded_error":
      return (
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-700"
        >
          {label}
        </Badge>
      );
    default:
      return <Badge variant="secondary">{label}</Badge>;
  }
}
