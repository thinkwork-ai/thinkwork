import { Search, Sparkles } from "lucide-react";
import { Badge, Button, Input } from "@thinkwork/ui";
import { computerTaskRoute } from "@/lib/computer-routes";

export interface TaskSummary {
  id: string;
  title?: string | null;
  status?: string | null;
  lifecycleStatus?: string | null;
  lastResponsePreview?: string | null;
  updatedAt?: string | null;
  artifactCount?: number | null;
}

interface TaskDashboardProps {
  tasks: TaskSummary[];
  isLoading?: boolean;
  error?: string | null;
}

export function TaskDashboard({
  tasks,
  isLoading = false,
  error,
}: TaskDashboardProps) {
  return (
    <main className="flex w-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Threads</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Follow Computer work from prompt to generated artifacts.
            </p>
          </div>
          <Button asChild>
            <a href="/computer">New thread</a>
          </Button>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search threads" />
          </label>
          <div className="flex rounded-lg border border-border/70 p-1">
            <Button type="button" size="sm" variant="secondary">
              Threads
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled>
              Archived
            </Button>
          </div>
        </div>

        {isLoading ? (
          <TaskDashboardState label="Loading threads" />
        ) : error ? (
          <TaskDashboardState label="Failed to load threads" tone="error" />
        ) : tasks.length === 0 ? (
          <TaskDashboardState label="No threads yet" />
        ) : (
          <section className="grid gap-3" aria-label="Computer threads">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function TaskRow({ task }: { task: TaskSummary }) {
  const title = task.title?.trim() || "Untitled thread";
  const href = computerTaskRoute(task.id);

  return (
    <article className="rounded-lg border border-border/70 bg-background/70 p-4 transition-colors hover:bg-accent/30">
      <a href={href} className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {task.lastResponsePreview ? (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {task.lastResponsePreview}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-md">
              {task.lifecycleStatus ?? task.status ?? "IDLE"}
            </Badge>
            {task.artifactCount ? (
              <Badge variant="secondary" className="gap-1 rounded-md">
                <Sparkles className="size-3.5" />
                {task.artifactCount} artifact
                {task.artifactCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
        </div>
        {task.updatedAt ? (
          <p className="text-xs text-muted-foreground">
            Updated {formatDate(task.updatedAt)}
          </p>
        ) : null}
      </a>
    </article>
  );
}

function TaskDashboardState({
  label,
  tone,
}: {
  label: string;
  tone?: "error";
}) {
  return (
    <div className="rounded-lg border border-border/70 p-8 text-center">
      <p
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {label}
      </p>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
