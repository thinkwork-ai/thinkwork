import { Activity } from "lucide-react";
import { Button } from "@thinkwork/ui";

interface UsageButtonProps {
  costSummary?: number | null;
}

export function UsageButton({ costSummary }: UsageButtonProps) {
  const label =
    typeof costSummary === "number" && Number.isFinite(costSummary)
      ? `$${costSummary.toFixed(2)}`
      : "Usage";

  return (
    <Button type="button" variant="ghost" size="sm" className="gap-2" disabled>
      <Activity className="size-4" />
      {label}
    </Button>
  );
}
