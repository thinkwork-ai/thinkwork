import { ChevronDown, CircleCheck, CircleDot, Wrench } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";

interface TaskEventRowProps {
  title: string;
  detail?: string | null;
  status?: "pending" | "running" | "completed" | "failed" | string | null;
}

export function TaskEventRow({ title, detail, status }: TaskEventRowProps) {
  const normalized = String(status ?? "completed").toLowerCase();
  const Icon = normalized === "completed" ? CircleCheck : CircleDot;

  return (
    <div className="flex gap-3 rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          <Badge variant="outline" className="rounded-md">
            {normalized}
          </Badge>
        </div>
        {detail ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="icon" disabled>
        <Wrench className="size-4" />
        <span className="sr-only">Tool details</span>
      </Button>
      <Button type="button" variant="ghost" size="icon" disabled>
        <ChevronDown className="size-4" />
        <span className="sr-only">Expand event</span>
      </Button>
    </div>
  );
}
