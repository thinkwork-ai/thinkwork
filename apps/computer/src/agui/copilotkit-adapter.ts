import { compareAguiEvents } from "./event-mapping";
import type { ThinkworkAguiEvent } from "./events";

export interface CopilotKitSpikeSnapshot {
  messages: CopilotKitSpikeMessage[];
  canvasComponents: CopilotKitSpikeCanvasComponent[];
  diagnostics: CopilotKitSpikeDiagnostic[];
  runState: "idle" | "running" | "finished";
  adoption: CopilotKitSpikeAdoption;
}

export interface CopilotKitSpikeMessage {
  id: string;
  role: "assistant";
  content: string;
  sourceEventIds: string[];
}

export interface CopilotKitSpikeCanvasComponent {
  id: string;
  component: string;
  props: Record<string, unknown>;
  sourceEventId: string;
}

export interface CopilotKitSpikeDiagnostic {
  id: string;
  severity: "info" | "warn" | "error";
  message: string;
  sourceEventId: string;
}

export interface CopilotKitSpikeAdoption {
  installPackage: false;
  packageCheckedAt: string;
  packageVersion: string;
  reason: string;
  checkedPackages: string[];
}

export const COPILOTKIT_SPIKE_ADOPTION: CopilotKitSpikeAdoption = {
  installPackage: false,
  packageCheckedAt: "2026-05-10",
  packageVersion: "@copilotkit/react-core@1.57.1",
  reason:
    "Keep ThinkWork AG-UI events as the source of truth until the spike proves a need for CopilotKit's React runtime/client footprint.",
  checkedPackages: [
    "@copilotkit/react-core@1.57.1",
    "@copilotkit/react-ui@1.57.1",
    "@ag-ui/client@0.0.53",
  ],
};

export function toCopilotKitSpikeSnapshot(
  events: ThinkworkAguiEvent[],
): CopilotKitSpikeSnapshot {
  const sortedEvents = [...events].sort(compareAguiEvents);
  const textEvents = sortedEvents.filter(
    (event) => event.type === "text_delta",
  );
  const text = textEvents.map((event) => event.text).join("");

  return {
    messages:
      text.length > 0
        ? [
            {
              id: "thinkwork-agui-assistant-message",
              role: "assistant",
              content: text,
              sourceEventIds: textEvents.map((event) => event.id),
            },
          ]
        : [],
    canvasComponents: sortedEvents
      .filter((event) => event.type === "canvas_component")
      .map((event) => ({
        id: `copilotkit-canvas-${event.id}`,
        component: event.component,
        props: event.props,
        sourceEventId: event.id,
      })),
    diagnostics: sortedEvents
      .filter((event) => event.type === "diagnostic")
      .map((event) => ({
        id: `copilotkit-diagnostic-${event.id}`,
        severity: event.severity,
        message: event.message,
        sourceEventId: event.id,
      })),
    runState: runStateFromEvents(sortedEvents),
    adoption: COPILOTKIT_SPIKE_ADOPTION,
  };
}

function runStateFromEvents(events: ThinkworkAguiEvent[]) {
  let latestRunEvent: ThinkworkAguiEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "run_started" || event.type === "run_finished") {
      latestRunEvent = event;
      break;
    }
  }

  if (!latestRunEvent) return "idle";
  return latestRunEvent.type === "run_finished" ? "finished" : "running";
}
