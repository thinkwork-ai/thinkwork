import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button, SidebarTrigger } from "@thinkwork/ui";

export function DesktopApplicationHeader() {
  return (
    <header className="desktop-app-header flex h-11 shrink-0 items-center gap-2 bg-background/95 pl-20 pr-3 text-foreground">
      <div className="desktop-app-header-controls flex items-center gap-1">
        <SidebarTrigger className="size-8" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">Back</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8"
          onClick={() => window.history.forward()}
        >
          <ArrowRight className="size-4" />
          <span className="sr-only">Forward</span>
        </Button>
      </div>
      <div className="min-w-0 pl-2">
        <h1 className="truncate text-sm font-medium">ThinkWork Spaces</h1>
      </div>
    </header>
  );
}
