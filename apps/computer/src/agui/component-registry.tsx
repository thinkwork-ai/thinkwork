import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { z } from "zod";
import type { AguiCanvasComponentEvent } from "./events";
import {
  LastMileRiskCanvas,
  type LastMileRiskCanvasProps,
} from "@/components/computer-agui/LastMileRiskCanvas";

const lastMileRiskCanvasSchema = z.object({
  title: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  kpis: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.union([z.string(), z.number()]),
        detail: z.string().optional().nullable(),
        tone: z.enum(["default", "risk", "success", "neutral"]).optional(),
      }),
    )
    .optional(),
  risks: z
    .array(
      z.object({
        account: z.string().min(1),
        opportunity: z.string().optional().nullable(),
        stage: z.string().optional().nullable(),
        amount: z.number().optional().nullable(),
        daysStale: z.number().int().nonnegative().optional().nullable(),
        riskLevel: z.enum(["low", "medium", "high"]).optional().nullable(),
        nextStep: z.string().optional().nullable(),
      }),
    )
    .optional(),
  sources: z
    .array(
      z.object({
        name: z.string().min(1),
        status: z.enum(["connected", "missing", "stale", "error"]),
        recordCount: z.number().int().nonnegative().optional().nullable(),
        asOf: z.string().optional().nullable(),
        detail: z.string().optional().nullable(),
      }),
    )
    .optional(),
});

type CanvasRegistryEntry = {
  parse: (props: Record<string, unknown>) => LastMileRiskCanvasProps;
  render: (props: LastMileRiskCanvasProps) => ReactNode;
};

const canvasRegistry: Record<string, CanvasRegistryEntry> = {
  lastmile_risk_canvas: {
    parse: (props) => lastMileRiskCanvasSchema.parse(props),
    render: (props) => <LastMileRiskCanvas {...props} />,
  },
};

export function AguiCanvasComponent({
  event,
}: {
  event: AguiCanvasComponentEvent;
}) {
  const entry = canvasRegistry[event.component];
  if (!entry) {
    return (
      <CanvasDiagnostic
        title="Unsupported Canvas component"
        detail={event.component}
      />
    );
  }

  try {
    return <>{entry.render(entry.parse(event.props))}</>;
  } catch (error) {
    return (
      <CanvasDiagnostic
        title="Invalid Canvas props"
        detail={error instanceof Error ? error.message : "Validation failed"}
      />
    );
  }
}

function CanvasDiagnostic({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950"
      role="alert"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4" />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5">{detail}</p>
    </div>
  );
}
