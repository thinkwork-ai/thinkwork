import { ArrowLeft, Copy, Plus } from "lucide-react";
import { Button } from "@thinkwork/ui";
import {
  COMPUTER_APPS_ROUTE,
  COMPUTER_WORKBENCH_ROUTE,
} from "@/lib/computer-routes";

interface AppTopBarProps {
  title: string;
}

export function AppTopBar({ title }: AppTopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-3 sm:px-4">
      <Button asChild variant="ghost" size="sm" className="gap-2">
        <a href={COMPUTER_APPS_ROUTE}>
          <ArrowLeft className="size-4" />
          Apps
        </a>
      </Button>
      <p className="min-w-0 truncate text-sm font-medium text-muted-foreground">
        Made with ThinkWork Computer:{" "}
        <span className="text-foreground">{title}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="hidden gap-2 sm:inline-flex"
        >
          <a href={COMPUTER_WORKBENCH_ROUTE}>
            <Plus className="size-4" />
            New task
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Copy private link"
          disabled
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </header>
  );
}
