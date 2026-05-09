import { CalendarClock, ShieldCheck } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import { formatDateTime } from "../formatters/date.js";

export interface AppHeaderBadge {
  label: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
}

export interface AppHeaderProps {
  title: string;
  summary?: string;
  badges?: AppHeaderBadge[];
  generatedAt?: string | Date;
  generatedAtLabel?: string;
  privacyLabel?: string;
}

export function AppHeader({
  title,
  summary,
  badges = [],
  generatedAt,
  generatedAtLabel = "As of",
  privacyLabel = "Private artifact",
}: AppHeaderProps) {
  return (
    <header className="flex flex-col gap-4 rounded-lg border border-border/70 bg-background p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {badges.map((badge) => (
            <Badge
              key={badge.label}
              variant={badge.variant ?? "secondary"}
              className="rounded-md"
            >
              {badge.label}
            </Badge>
          ))}
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-500" />
            {privacyLabel}
          </span>
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h2>
        {summary ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {summary}
          </p>
        ) : null}
      </div>
      {generatedAt ? (
        <div className="shrink-0 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="size-4" />
            {generatedAtLabel}
          </div>
          <p className="mt-1 font-medium">{formatDateTime(generatedAt)}</p>
        </div>
      ) : null}
    </header>
  );
}
