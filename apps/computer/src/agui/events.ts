export type ThinkworkAguiEvent =
  | AguiRunEvent
  | AguiTextDeltaEvent
  | AguiToolCallEvent
  | AguiCanvasComponentEvent
  | AguiDiagnosticEvent;

export interface AguiBaseEvent {
  id: string;
  seq?: number;
  createdAt?: string | null;
  source: "chunk" | "computer_event" | "adapter";
}

export interface AguiRunEvent extends AguiBaseEvent {
  type: "run_started" | "run_finished";
  title: string;
  detail?: string | null;
  status?: string | null;
}

export interface AguiTextDeltaEvent extends AguiBaseEvent {
  type: "text_delta";
  text: string;
}

export interface AguiToolCallEvent extends AguiBaseEvent {
  type: "tool_call_started" | "tool_call_finished";
  toolName: string;
  title: string;
  detail?: string | null;
  status?: string | null;
}

export interface AguiCanvasComponentEvent extends AguiBaseEvent {
  type: "canvas_component";
  component: string;
  props: Record<string, unknown>;
}

export interface AguiDiagnosticEvent extends AguiBaseEvent {
  type: "diagnostic";
  severity: "info" | "warn" | "error";
  message: string;
  raw?: unknown;
}

export interface AguiChunkInput {
  seq: number;
  chunk?: unknown;
  publishedAt?: string | null;
}

export interface AguiComputerEventInput {
  id: string;
  eventType?: string | null;
  level?: string | null;
  payload?: unknown;
  createdAt?: string | null;
  taskId?: string | null;
}
