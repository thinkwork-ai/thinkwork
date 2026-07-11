import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { PanelRightOpen } from "lucide-react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";

const FIXED_INSPECTOR_QUERY = "(min-width: 1536px)";

function useFixedInspector() {
  const [fixed, setFixed] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(FIXED_INSPECTOR_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(FIXED_INSPECTOR_QUERY);
    const update = () => setFixed(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return fixed;
}

export function WorkflowCanvasWorkspace({
  canvas,
  inspector,
  inspectorKey,
  leading,
  onInspectorClose,
  className,
}: {
  canvas: ReactNode;
  inspector: ReactNode;
  inspectorKey?: string | null;
  leading?: ReactNode;
  onInspectorClose?: () => void;
  className?: string;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const fixedInspector = useFixedInspector();

  useEffect(() => {
    setInspectorOpen(!fixedInspector && Boolean(inspectorKey));
  }, [fixedInspector, inspectorKey]);

  function setOpen(open: boolean) {
    setInspectorOpen(open);
    if (!open && inspectorKey) onInspectorClose?.();
  }

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 overflow-hidden", className)}
    >
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-4",
          leading
            ? "grid-cols-[200px_minmax(360px,1fr)] xl:grid-cols-[220px_minmax(420px,1fr)] 2xl:grid-cols-[220px_minmax(420px,1fr)_400px]"
            : "grid-cols-[minmax(0,1fr)] 2xl:grid-cols-[minmax(420px,1fr)_400px]",
        )}
      >
        {leading}
        <div className="relative min-h-0 min-w-0">{canvas}</div>
        {fixedInspector ? (
          <aside
            data-testid="workflow-fixed-inspector"
            className="min-h-0 overflow-y-auto rounded-md border border-border bg-card"
          >
            {inspector}
          </aside>
        ) : null}
      </div>
      {!fixedInspector ? (
        <Sheet open={inspectorOpen} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="absolute right-3 top-3 z-10 bg-background/90 shadow-sm"
              aria-label="Open inspector panel"
            >
              <PanelRightOpen className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(440px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
            <SheetHeader className="border-b border-border pr-12">
              <SheetTitle>Details</SheetTitle>
              <SheetDescription>
                Inspect and update the selected workflow context.
              </SheetDescription>
            </SheetHeader>
            <div data-testid="workflow-inspector-panel" className="p-4">
              {inspector}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
