import type {
  AguiChunkInput,
  AguiComputerEventInput,
  ThinkworkAguiEvent,
} from "./events";

const RUN_STARTED_EVENTS = new Set([
  "thread_turn_enqueued",
  "thread_turn_dispatched",
  "thread_turn_claimed",
]);

const RUN_FINISHED_EVENTS = new Set([
  "thread_turn_response_recorded",
  "thread_turn_dispatch_failed",
  "task_completed",
  "task_failed",
  "computer_task_completed",
  "computer_task_failed",
]);

export function aguiEventsFromChunk(
  input: AguiChunkInput,
): ThinkworkAguiEvent[] {
  const chunk = parseChunk(input.chunk);
  if (!chunk) {
    return [
      diagnosticFromChunk(input, "Chunk was not valid JSON or object", "warn"),
    ];
  }

  const type = stringValue(chunk.type) || stringValue(chunk.eventType);
  if (!type) {
    const text = textValue(chunk.text);
    if (text !== null) {
      return [
        {
          id: `chunk-${input.seq}-text`,
          type: "text_delta",
          source: "chunk",
          seq: input.seq,
          createdAt: input.publishedAt ?? null,
          text,
        },
      ];
    }
    return [diagnosticFromChunk(input, "Chunk did not include text or type")];
  }

  if (type === "text_delta") {
    const payload = recordValue(chunk.payload);
    const text = textValue(chunk.text) ?? textValue(payload?.text);
    if (text === null) {
      return [diagnosticFromChunk(input, "text_delta missing text")];
    }
    return [
      {
        id: eventId(input, chunk, "text"),
        type: "text_delta",
        source: "chunk",
        seq: input.seq,
        createdAt: input.publishedAt ?? stringValue(chunk.timestamp) ?? null,
        text,
      },
    ];
  }

  if (type === "canvas_component") {
    const payload = recordValue(chunk.payload);
    const component =
      stringValue(chunk.component) ||
      stringValue(chunk.componentName) ||
      stringValue(payload?.component) ||
      stringValue(payload?.componentName);
    const propsValue = recordValue(chunk.props) ?? recordValue(payload?.props);
    if (!component || !propsValue) {
      return [
        diagnosticFromChunk(
          input,
          "canvas_component missing component or props",
        ),
      ];
    }
    return [
      {
        id: eventId(input, chunk, "canvas"),
        type: "canvas_component",
        source: "chunk",
        seq: input.seq,
        createdAt: input.publishedAt ?? stringValue(chunk.timestamp) ?? null,
        component,
        props: propsValue,
      },
    ];
  }

  if (type === "run_started" || type === "run_finished") {
    const payload = recordValue(chunk.payload);
    return [
      {
        id: eventId(input, chunk, "run"),
        type,
        source: "chunk",
        seq: input.seq,
        createdAt: input.publishedAt ?? stringValue(chunk.timestamp) ?? null,
        title:
          stringValue(chunk.title) ||
          stringValue(payload?.title) ||
          titleize(type),
        detail:
          stringValue(chunk.detail) || stringValue(payload?.detail) || null,
        status:
          stringValue(chunk.status) || stringValue(payload?.status) || null,
      },
    ];
  }

  if (type === "tool_call_started" || type === "tool_call_finished") {
    const payload = recordValue(chunk.payload);
    const toolName =
      stringValue(chunk.toolName) ||
      stringValue(chunk.tool_name) ||
      stringValue(payload?.toolName) ||
      stringValue(payload?.tool_name);
    if (!toolName) {
      return [diagnosticFromChunk(input, `${type} missing tool name`)];
    }
    return [
      {
        id: eventId(input, chunk, "tool"),
        type,
        source: "chunk",
        seq: input.seq,
        createdAt: input.publishedAt ?? stringValue(chunk.timestamp) ?? null,
        toolName,
        title:
          stringValue(chunk.title) ||
          stringValue(payload?.title) ||
          titleize(toolName),
        detail:
          stringValue(chunk.detail) || stringValue(payload?.detail) || null,
        status:
          stringValue(chunk.status) || stringValue(payload?.status) || null,
      },
    ];
  }

  if (type === "diagnostic") {
    return [
      {
        id: eventId(input, chunk, "diagnostic"),
        type: "diagnostic",
        source: "chunk",
        seq: input.seq,
        createdAt: input.publishedAt ?? stringValue(chunk.timestamp) ?? null,
        severity: severityValue(chunk.severity),
        message: stringValue(chunk.message) || "Diagnostic event",
        raw: input.chunk,
      },
    ];
  }

  return [
    diagnosticFromChunk(input, `Unsupported AG-UI event type: ${type}`, "warn"),
  ];
}

export function aguiEventsFromComputerEvents(
  events: AguiComputerEventInput[],
): ThinkworkAguiEvent[] {
  return events
    .map(aguiEventFromComputerEvent)
    .filter((event): event is ThinkworkAguiEvent => Boolean(event))
    .sort(compareAguiEvents);
}

function aguiEventFromComputerEvent(
  event: AguiComputerEventInput,
): ThinkworkAguiEvent | null {
  const eventType = stringValue(event.eventType);
  if (!eventType) return null;
  const payload = recordValue(event.payload);

  if (RUN_STARTED_EVENTS.has(eventType)) {
    return {
      id: `computer-event-${event.id}`,
      type: "run_started",
      source: "computer_event",
      createdAt: event.createdAt ?? null,
      title: titleize(eventType),
      detail: detailFromPayload(payload),
      status: eventType,
    };
  }

  if (RUN_FINISHED_EVENTS.has(eventType)) {
    return {
      id: `computer-event-${event.id}`,
      type: "run_finished",
      source: "computer_event",
      createdAt: event.createdAt ?? null,
      title: titleize(eventType),
      detail: detailFromPayload(payload),
      status: eventType,
    };
  }

  if (eventType === "tool_invocation_started") {
    const toolName =
      stringValue(payload?.tool_name) ||
      stringValue(payload?.toolName) ||
      "tool";
    return {
      id: `computer-event-${event.id}`,
      type: "tool_call_started",
      source: "computer_event",
      createdAt: event.createdAt ?? null,
      toolName,
      title: titleize(toolName),
      detail: detailFromPayload(payload),
      status: "started",
    };
  }

  if (
    eventType === "browser_automation_completed" ||
    eventType === "browser_automation_failed" ||
    eventType === "browser_automation_unavailable"
  ) {
    return {
      id: `computer-event-${event.id}`,
      type: "tool_call_finished",
      source: "computer_event",
      createdAt: event.createdAt ?? null,
      toolName: "browser_automation",
      title: titleize(eventType),
      detail: detailFromPayload(payload),
      status: eventType,
    };
  }

  if (eventType === "browser_automation_started") {
    return {
      id: `computer-event-${event.id}`,
      type: "tool_call_started",
      source: "computer_event",
      createdAt: event.createdAt ?? null,
      toolName: "browser_automation",
      title: titleize(eventType),
      detail: detailFromPayload(payload),
      status: "started",
    };
  }

  return null;
}

export function mergeAguiEvents(
  current: ThinkworkAguiEvent[],
  next: ThinkworkAguiEvent[],
) {
  const byId = new Map<string, ThinkworkAguiEvent>();
  for (const event of current) byId.set(event.id, event);
  for (const event of next) byId.set(event.id, event);
  return [...byId.values()].sort(compareAguiEvents);
}

export function compareAguiEvents(
  a: ThinkworkAguiEvent,
  b: ThinkworkAguiEvent,
) {
  const aSeq = typeof a.seq === "number" ? a.seq : Number.MAX_SAFE_INTEGER;
  const bSeq = typeof b.seq === "number" ? b.seq : Number.MAX_SAFE_INTEGER;
  if (aSeq !== bSeq) return aSeq - bSeq;
  const aTime = Date.parse(a.createdAt ?? "") || 0;
  const bTime = Date.parse(b.createdAt ?? "") || 0;
  if (aTime !== bTime) return aTime - bTime;
  return a.id.localeCompare(b.id);
}

function parseChunk(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return recordValue(parsed);
    } catch {
      return null;
    }
  }
  return recordValue(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function severityValue(value: unknown): "info" | "warn" | "error" {
  if (value === "error" || value === "warn" || value === "info") return value;
  return "warn";
}

function eventId(
  input: AguiChunkInput,
  chunk: Record<string, unknown>,
  fallback: string,
) {
  return (
    stringValue(chunk.eventId) ||
    stringValue(chunk.id) ||
    `chunk-${input.seq}-${fallback}`
  );
}

function diagnosticFromChunk(
  input: AguiChunkInput,
  message: string,
  severity: "info" | "warn" | "error" = "error",
): ThinkworkAguiEvent {
  return {
    id: `chunk-${input.seq}-diagnostic`,
    type: "diagnostic",
    source: "adapter",
    seq: input.seq,
    createdAt: input.publishedAt ?? null,
    severity,
    message,
    raw: input.chunk,
  };
}

function detailFromPayload(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  return (
    stringValue(payload.message) ||
    stringValue(payload.reason) ||
    stringValue(payload.error) ||
    stringValue(payload.threadId) ||
    null
  );
}

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
