/**
 * GenUI Component Registry
 *
 * Maps `_type` values from MCP tool results to React components.
 * When a message contains JSON with a `_type` field, the registry
 * determines which component renders it inline in the chat.
 *
 * To add a new type:
 * 1. Create a component in components/genui/
 * 2. Register it here with its _type key
 */

import React from "react";

export interface GenUIProps {
  data: Record<string, unknown>;
  onAction?: (action: GenUIAction) => void;
  /**
   * Optional message/thread context. Populated by ActivityTimeline so
   * interactive cards (e.g. PRD-46 QuestionCard) can send a follow-up
   * message back into the thread when the user submits.
   */
  context?: GenUIContext;
}

export type GenUIAction = {
  type: "tool.invoke";
  tool: string;
  args: Record<string, unknown>;
};

export interface GenUIContext {
  /** Thread the card is rendered in. */
  threadId: string;
  /** Tenant the thread belongs to. */
  tenantId: string;
  /** Message that emitted this card (carries the tool result). */
  messageId: string;
  /** Index of the tool result inside the message's toolResults array. */
  toolIndex: number;
  /** Current user's id (for senderId on outgoing messages). May be undefined if not yet loaded. */
  currentUserId?: string;
  /**
   * Pre-filtered audit rows for the task card's `activity_list` block.
   *
   * Supplied by the task detail screen from the raw messages query, filtered
   * to `role=system` / `metadata.kind = "external_task_event"`. The chat
   * timeline itself does NOT render these rows — they live exclusively on
   * the task card as a compact activity log.
   */
  activityRows?: Array<{
    id: string;
    content: string;
    createdAt: string;
  }>;
  /**
   * Hide the in-card edit button. Set by the pinned task header on the Task
   * Detail page so the page-level dropdown becomes the single edit entry
   * point and the card stays free of duplicate chrome.
   */
  hideEditButton?: boolean;
  /**
   * Monotonically increasing counter driven by the page-level "Edit Task"
   * dropdown item. When it changes, the card opens its edit sheet.
   */
  editRequestCounter?: number;
}

// Lazy imports to keep bundle size down
const TaskList = React.lazy(() => import("@/components/genui/TaskList"));
const TaskCard = React.lazy(() => import("@/components/genui/TaskCard"));
const QuestionCard = React.lazy(
  () => import("@/components/genui/QuestionCard"),
);

const REGISTRY: Record<
  string,
  React.LazyExoticComponent<React.ComponentType<GenUIProps>>
> = {
  task_list: TaskList,
  task: TaskCard,
  question_card: QuestionCard,
};

/**
 * Try to parse a string as typed JSON.
 * Returns the parsed object if it has a `_type` field, null otherwise.
 */
export function parseTypedJson(
  content: string,
): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed._type === "string"
    ) {
      return parsed;
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

/**
 * Look up a component for the given _type.
 */
export function getGenUIComponent(
  type: string,
): React.LazyExoticComponent<React.ComponentType<GenUIProps>> | null {
  return REGISTRY[type] || null;
}

// ---------------------------------------------------------------------------
// Thread generated UI mobile fallback parser
// ---------------------------------------------------------------------------

export interface MobileGeneratedUIDiagnostic {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export interface MobileJsonRenderFallback {
  id: string;
  title: string;
  summary: string;
  lines: string[];
  status: "ready" | "streaming" | "invalid" | "stale" | "unsupported";
  component?: string;
  specHash?: string;
  diagnostics?: MobileGeneratedUIDiagnostic[];
}

const GENERIC_MOBILE_FALLBACK: Omit<
  MobileJsonRenderFallback,
  "id" | "diagnostics"
> = {
  title: "Generated view",
  summary: "Open this thread on web to view the generated interface.",
  lines: [],
  status: "unsupported",
};

const THREAD_JSON_RENDER_PART_TYPE = "data-json-render";
const LEGACY_THREAD_GENUI_PART_TYPE = "data-genui";
const THREAD_JSON_RENDER_SCHEMA_VERSION = "thread-json-render/v1";
const THREAD_JSON_RENDER_CATALOG_VERSION = "thread-json-render-catalog/v1";
const STATUS_VALUES = new Set(["ready", "streaming", "invalid", "stale"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseParts(parts: unknown): unknown[] {
  if (Array.isArray(parts)) return parts;
  if (typeof parts !== "string") return [];
  try {
    const parsed = JSON.parse(parts);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rootComponent(data: Record<string, unknown>): string | undefined {
  const spec = data.spec;
  if (!isRecord(spec)) return undefined;
  const root = typeof spec.root === "string" ? spec.root : undefined;
  const elements = spec.elements;
  if (!root || !isRecord(elements)) return undefined;
  const element = elements[root];
  if (!isRecord(element)) return undefined;
  return typeof element.type === "string" ? element.type : undefined;
}

function fallbackId(part: unknown, index: number): string {
  if (isRecord(part) && typeof part.id === "string" && part.id.length > 0) {
    return part.id;
  }
  return `data-json-render:${index}`;
}

function diagnostic(
  code: string,
  message: string,
  path?: string,
): MobileGeneratedUIDiagnostic {
  return { code, message, path, severity: "error" };
}

function normalizeDiagnostics(value: unknown): MobileGeneratedUIDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const code = typeof item.code === "string" ? item.code : undefined;
    const message = typeof item.message === "string" ? item.message : undefined;
    const severity =
      item.severity === "warning" || item.severity === "error"
        ? item.severity
        : "error";
    if (!code || !message) return [];
    return [
      {
        code,
        message,
        path: typeof item.path === "string" ? item.path : undefined,
        severity,
      },
    ];
  });
}

function normalizeLines(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === "string")
    : [];
}

function unsupportedFallback(
  part: unknown,
  index: number,
  diagnostics: MobileGeneratedUIDiagnostic[] = [],
): MobileJsonRenderFallback {
  return {
    id: fallbackId(part, index),
    ...GENERIC_MOBILE_FALLBACK,
    diagnostics,
  };
}

export function parseThreadJsonRenderMobileFallbacks(
  parts: unknown,
): MobileJsonRenderFallback[] {
  return parseParts(parts).flatMap((part, index) => {
    if (!isRecord(part)) return [];

    if (part.type === LEGACY_THREAD_GENUI_PART_TYPE) {
      return [
        {
          id: fallbackId(part, index),
          title: "Legacy generated UI unsupported",
          summary: "This generated view uses the retired data-genui contract.",
          lines: [],
          status: "unsupported",
          diagnostics: [
            diagnostic(
              "JSON_RENDER_LEGACY_GENUI_UNSUPPORTED",
              "Legacy data-genui payloads are not rendered on mobile.",
              "$.type",
            ),
          ],
        },
      ];
    }

    if (part.type !== THREAD_JSON_RENDER_PART_TYPE) return [];

    const data = isRecord(part.data) ? part.data : {};
    const diagnostics: MobileGeneratedUIDiagnostic[] = [];
    if (data.schemaVersion !== THREAD_JSON_RENDER_SCHEMA_VERSION) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_SCHEMA_VERSION_UNSUPPORTED",
          `Expected ${THREAD_JSON_RENDER_SCHEMA_VERSION}.`,
          "$.data.schemaVersion",
        ),
      );
    }
    if (data.catalogVersion !== THREAD_JSON_RENDER_CATALOG_VERSION) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_CATALOG_VERSION_UNSUPPORTED",
          `Expected ${THREAD_JSON_RENDER_CATALOG_VERSION}.`,
          "$.data.catalogVersion",
        ),
      );
    }
    if (!STATUS_VALUES.has(String(data.status))) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_STATUS_INVALID",
          "Unsupported generated UI status.",
          "$.data.status",
        ),
      );
    }

    const mobileFallback = isRecord(data.mobileFallback)
      ? data.mobileFallback
      : {};
    const title =
      typeof mobileFallback.title === "string"
        ? mobileFallback.title
        : undefined;
    const summary =
      typeof mobileFallback.summary === "string"
        ? mobileFallback.summary
        : undefined;
    if (!title || !summary) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_MOBILE_FALLBACK_REQUIRED",
          "Generated UI mobile fallback requires title and summary.",
          "$.data.mobileFallback",
        ),
      );
    }

    if (diagnostics.length > 0 || !title || !summary) {
      return [unsupportedFallback(part, index, diagnostics)];
    }

    return [
      {
        id: fallbackId(part, index),
        title,
        summary,
        lines: normalizeLines(mobileFallback.lines),
        status: data.status as MobileJsonRenderFallback["status"],
        component: rootComponent(data),
        specHash: typeof data.specHash === "string" ? data.specHash : undefined,
        diagnostics: normalizeDiagnostics(data.diagnostics),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Mixed content block parser
// ---------------------------------------------------------------------------

export type MessageBlock =
  | { type: "text"; content: string }
  | {
      type: "genui";
      data: Record<string, unknown>;
      component: React.LazyExoticComponent<React.ComponentType<GenUIProps>>;
    };

/**
 * Parse message content into blocks of text and GenUI components.
 *
 * Splits on ```genui ... ``` fences. Text between fences becomes text blocks.
 * JSON inside fences becomes GenUI blocks if _type is registered.
 *
 * Also handles the case where the entire message is a single JSON object
 * with _type (no fence needed — pure tool passthrough).
 *
 * Returns null if no GenUI content is found (caller should use markdown).
 */
export function parseMessageBlocks(content: string): MessageBlock[] | null {
  // Case 1: entire message is typed JSON (pure passthrough)
  const pureJson = parseTypedJson(content);
  if (pureJson) {
    const comp = getGenUIComponent(String(pureJson._type));
    if (comp) return [{ type: "genui", data: pureJson, component: comp }];
  }

  // Case 2: mixed content with ```genui fences
  if (!content.includes("```genui")) return null;

  const blocks: MessageBlock[] = [];
  const parts = content.split(/```genui\s*\n?/);

  for (let i = 0; i < parts.length; i++) {
    if (i === 0) {
      // Text before first fence
      const text = parts[0].trim();
      if (text) blocks.push({ type: "text", content: text });
      continue;
    }

    // This part starts after a ```genui — split on closing ```
    const closingIdx = parts[i].indexOf("```");
    if (closingIdx === -1) {
      // No closing fence — treat as text
      const text = parts[i].trim();
      if (text) blocks.push({ type: "text", content: text });
      continue;
    }

    const jsonStr = parts[i].slice(0, closingIdx).trim();
    const afterFence = parts[i].slice(closingIdx + 3).trim();

    // Parse the JSON
    const data = parseTypedJson(jsonStr);
    if (data) {
      const comp = getGenUIComponent(String(data._type));
      if (comp) {
        blocks.push({ type: "genui", data, component: comp });
      } else {
        // Unknown _type — render as code block text
        blocks.push({ type: "text", content: "```json\n" + jsonStr + "\n```" });
      }
    } else {
      // Invalid JSON — render as text
      blocks.push({ type: "text", content: jsonStr });
    }

    // Text after closing fence
    if (afterFence) blocks.push({ type: "text", content: afterFence });
  }

  return blocks.length > 0 ? blocks : null;
}
