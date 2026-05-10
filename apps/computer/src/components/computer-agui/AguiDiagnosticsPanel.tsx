import { AlertTriangle } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import type { ThinkworkAguiEvent } from "@/agui/events";

interface AguiDiagnosticsPanelProps {
  diagnostics: ThinkworkAguiEvent[];
}

export function AguiDiagnosticsPanel({
  diagnostics,
}: AguiDiagnosticsPanelProps) {
  const diagnosticEvents = diagnostics.filter(
    (event) => event.type === "diagnostic",
  );
  if (diagnosticEvents.length === 0) return null;

  return (
    <section
      className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-amber-950"
      aria-label="AG-UI diagnostics"
    >
      <div className="mx-auto grid max-w-6xl gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Diagnostics
          <Badge variant="secondary">{diagnosticEvents.length}</Badge>
        </div>
        <div className="grid gap-2">
          {diagnosticEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-md border border-amber-200 bg-background/80 px-3 py-2 text-sm"
            >
              <span className="font-medium">{event.severity}</span>:{" "}
              <span>{event.message}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
