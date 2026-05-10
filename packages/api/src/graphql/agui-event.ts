import { publishComputerThreadChunk } from "./notify.js";

export type ComputerAguiEventType =
  | "run_started"
  | "run_finished"
  | "text_delta"
  | "tool_call_started"
  | "tool_call_finished"
  | "canvas_component"
  | "diagnostic";

export interface ComputerAguiEventInput {
  threadId: string;
  seq: number;
  type: ComputerAguiEventType;
  eventId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export async function publishComputerAguiEvent(input: ComputerAguiEventInput) {
  const event = toComputerAguiEvent(input);
  await publishComputerThreadChunk({
    threadId: input.threadId,
    seq: input.seq,
    chunk: event,
  });
  return event;
}

export function toComputerAguiEvent(input: ComputerAguiEventInput) {
  assertComputerAguiEventInput(input);
  return {
    type: input.type,
    eventId: input.eventId ?? `agui-${input.threadId}-${input.seq}`,
    threadId: input.threadId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload ?? {},
  };
}

function assertComputerAguiEventInput(input: ComputerAguiEventInput) {
  if (!input.threadId?.trim()) {
    throw new Error("AG-UI event threadId is required");
  }
  if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
    throw new Error("AG-UI event seq must be a positive integer");
  }
  if (!AGUI_EVENT_TYPES.has(input.type)) {
    throw new Error(`Unsupported AG-UI event type: ${String(input.type)}`);
  }
  if (
    input.payload !== undefined &&
    (!input.payload ||
      typeof input.payload !== "object" ||
      Array.isArray(input.payload))
  ) {
    throw new Error("AG-UI event payload must be an object when provided");
  }
}

const AGUI_EVENT_TYPES = new Set<ComputerAguiEventType>([
  "run_started",
  "run_finished",
  "text_delta",
  "tool_call_started",
  "tool_call_finished",
  "canvas_component",
  "diagnostic",
]);
