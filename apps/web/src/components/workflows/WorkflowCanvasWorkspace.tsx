import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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

const MIN_FIXED_CANVAS_WIDTH = 700;
const GRID_GAP = 16;
const LEADING_WIDTH = 200;
const WIDE_LEADING_WIDTH = 220;
const WIDE_LEADING_QUERY = "(min-width: 1280px)";

function hasFixedInspectorSpace({
  workspaceWidth,
  hasLeading,
  wideLeading,
}: {
  workspaceWidth: number;
  hasLeading: boolean;
  wideLeading: boolean;
}) {
  const leadingWidth = hasLeading
    ? wideLeading
      ? WIDE_LEADING_WIDTH
      : LEADING_WIDTH
    : 0;
  const gapWidth = hasLeading ? GRID_GAP : 0;
  const canvasWidth = workspaceWidth - leadingWidth - gapWidth;

  return canvasWidth > MIN_FIXED_CANVAS_WIDTH;
}

function useFixedInspector(hasLeading: boolean) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [fixed, setFixed] = useState(false);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const update = (workspaceWidth: number) => {
      const wideLeading =
        typeof window.matchMedia === "function" &&
        window.matchMedia(WIDE_LEADING_QUERY).matches;
      setFixed(
        hasFixedInspectorSpace({
          workspaceWidth,
          hasLeading,
          wideLeading,
        }),
      );
    };

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(([entry]) => {
        if (entry) update(entry.contentRect.width);
      });
      observer.observe(workspace);
      return () => observer.disconnect();
    }

    const measure = () => update(workspace.getBoundingClientRect().width);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [hasLeading]);

  return { fixed, workspaceRef };
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
  const { fixed: fixedInspector, workspaceRef } = useFixedInspector(
    Boolean(leading),
  );

  useEffect(() => {
    setInspectorOpen(!fixedInspector && Boolean(inspectorKey));
  }, [fixedInspector, inspectorKey]);

  function setOpen(open: boolean) {
    setInspectorOpen(open);
    if (!open && inspectorKey) onInspectorClose?.();
  }

  return (
    <div
      ref={workspaceRef}
      className={cn("relative flex min-h-0 flex-1 overflow-hidden", className)}
    >
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-4",
          leading
            ? fixedInspector
              ? "grid-cols-[200px_minmax(0,1fr)_400px] xl:grid-cols-[220px_minmax(0,1fr)_400px]"
              : "grid-cols-[200px_minmax(360px,1fr)] xl:grid-cols-[220px_minmax(420px,1fr)]"
            : fixedInspector
              ? "grid-cols-[minmax(0,1fr)_400px]"
              : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        {leading}
        <div className="relative min-h-0 min-w-0">{canvas}</div>
        {fixedInspector ? (
          <aside
            data-testid="workflow-fixed-inspector"
            className="min-h-0 overflow-y-auto"
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
              variant="ghost"
              size="icon-sm"
              className="absolute right-3 top-3 z-10 items-center bg-background/90"
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
