import { Boxes, Component } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { ThinkworkAguiEvent } from "@/agui/events";

interface AguiCanvasProps {
  events: ThinkworkAguiEvent[];
}

export function AguiCanvas({ events }: AguiCanvasProps) {
  const canvasEvents = events.filter(
    (event) => event.type === "canvas_component",
  );
  const latestCanvas = canvasEvents.at(-1);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-muted/25">
      <div className="grid gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Canvas</h2>
          </div>
          <Badge variant="outline">{canvasEvents.length}</Badge>
        </div>

        {latestCanvas ? (
          <div className="grid gap-3 rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2">
              <Component className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{latestCanvas.component}</span>
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
              {JSON.stringify(latestCanvas.props, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-background px-4 py-8 text-sm text-muted-foreground">
            Waiting for Canvas output.
          </div>
        )}
      </div>
    </section>
  );
}
