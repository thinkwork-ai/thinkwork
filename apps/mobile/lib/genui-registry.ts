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

import React from 'react';

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

export type GenUIAction =
  | {
      type: 'tool.invoke';
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      /**
       * Direct-path external task action — routed to
       * `executeExternalTaskAction` without going through the agent.
       * See .prds/external-task-integration.md §3.5.
       */
      type: 'external_task.action';
      actionType:
        | 'external_task.update_status'
        | 'external_task.assign'
        | 'external_task.comment'
        | 'external_task.edit_fields'
        | 'external_task.refresh';
      params: Record<string, unknown>;
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
}

// Lazy imports to keep bundle size down
const TaskList = React.lazy(() => import('@/components/genui/TaskList'));
const TaskCard = React.lazy(() => import('@/components/genui/TaskCard'));
const QuestionCard = React.lazy(() => import('@/components/genui/QuestionCard'));
const ExternalTaskCard = React.lazy(() => import('@/components/genui/external-task/ExternalTaskCard'));

const REGISTRY: Record<string, React.LazyExoticComponent<React.ComponentType<GenUIProps>>> = {
  task_list: TaskList,
  task: TaskCard,
  question_card: QuestionCard,
  external_task: ExternalTaskCard,
};

/**
 * Try to parse a string as typed JSON.
 * Returns the parsed object if it has a `_type` field, null otherwise.
 */
export function parseTypedJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && typeof parsed._type === 'string') {
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
export function getGenUIComponent(type: string): React.LazyExoticComponent<React.ComponentType<GenUIProps>> | null {
  return REGISTRY[type] || null;
}

// ---------------------------------------------------------------------------
// Mixed content block parser
// ---------------------------------------------------------------------------

export type MessageBlock =
  | { type: 'text'; content: string }
  | { type: 'genui'; data: Record<string, unknown>; component: React.LazyExoticComponent<React.ComponentType<GenUIProps>> };

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
    if (comp) return [{ type: 'genui', data: pureJson, component: comp }];
  }

  // Case 2: mixed content with ```genui fences
  if (!content.includes('```genui')) return null;

  const blocks: MessageBlock[] = [];
  const parts = content.split(/```genui\s*\n?/);

  for (let i = 0; i < parts.length; i++) {
    if (i === 0) {
      // Text before first fence
      const text = parts[0].trim();
      if (text) blocks.push({ type: 'text', content: text });
      continue;
    }

    // This part starts after a ```genui — split on closing ```
    const closingIdx = parts[i].indexOf('```');
    if (closingIdx === -1) {
      // No closing fence — treat as text
      const text = parts[i].trim();
      if (text) blocks.push({ type: 'text', content: text });
      continue;
    }

    const jsonStr = parts[i].slice(0, closingIdx).trim();
    const afterFence = parts[i].slice(closingIdx + 3).trim();

    // Parse the JSON
    const data = parseTypedJson(jsonStr);
    if (data) {
      const comp = getGenUIComponent(String(data._type));
      if (comp) {
        blocks.push({ type: 'genui', data, component: comp });
      } else {
        // Unknown _type — render as code block text
        blocks.push({ type: 'text', content: '```json\n' + jsonStr + '\n```' });
      }
    } else {
      // Invalid JSON — render as text
      blocks.push({ type: 'text', content: jsonStr });
    }

    // Text after closing fence
    if (afterFence) blocks.push({ type: 'text', content: afterFence });
  }

  return blocks.length > 0 ? blocks : null;
}
