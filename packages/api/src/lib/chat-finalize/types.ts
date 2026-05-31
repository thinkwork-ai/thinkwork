/**
 * Shape of the JSON body that the Strands runtime POSTs to
 * /api/threads/{threadId}/finalize at end-of-turn (plan 2026-05-22-006).
 *
 * Mirrors the AgentCore Lambda-response shape that chat-agent-invoke
 * consumed today (when it was waiting synchronously). The fields are the
 * superset of every value the post-AgentCore code path reads.
 */
import type { ChangedFilePayload } from "./reconcile.js";

export interface FinalizePayload {
  /** Idempotency key — `thread_turns.id` that chat-agent-invoke inserted before dispatching. */
  thread_turn_id: string;
  /** Tenant scope. */
  tenant_id: string;
  /** Agent that produced the response. */
  agent_id: string;
  /** Thread this turn belongs to. */
  thread_id: string;
  /** Optional W3C trace ID for cost/observability bookkeeping. */
  trace_id?: string;
  /** Original user message text (kept short for guardrail-block snapshot). */
  user_message?: string;
  /** Optional model id reported by the runtime (drives cost lookup). */
  agent_model?: string | null;
  /** Runtime substrate used for this turn; also persisted on thread_turns/cost_events. */
  runtime_type?: string | null;
  /** Agent slug — used as the Hindsight bank id when recording Hindsight cost. */
  agent_slug?: string | null;
  /** Agent display name — used in cost notifications + push body title. */
  agent_name?: string | null;
  /** Total duration of the turn (ms) — recorded against the turn + cost events. */
  duration_ms: number;
  /** Terminal status of the turn. */
  status: "completed" | "failed";
  /** Free-text error when `status: "failed"`. */
  error_message?: string;
  /** Text workspace file changes captured by the runtime after the turn. */
  changed_files?: ChangedFilePayload[];
  /** Composed runtime system prompt captured for this turn, when available. */
  composed_system_prompt?: string | null;
  /** Computer task / event context for tasks that originated from the Computer surface. */
  computer_id?: string | null;
  computer_task_id?: string | null;
  /** The AgentCore response payload — same shape `invokeResult.response` had today. */
  response?: {
    /** Composed runtime system prompt captured for this turn, when available. */
    composed_system_prompt?: string | null;
    /** Bedrock content (string or ChatCompletion-shaped object). */
    content?: string;
    output?: string;
    text?: string;
    runtime?: string;
    runtime_host?: string | null;
    choices?: unknown;
    /** Tool invocations with optional genui_data for UI render. */
    tool_invocations?: Array<Record<string, unknown>>;
    /** Tools called (legacy + flat list for thread_turns.usage_json). */
    tools_called?: string[];
    /** Tool cost rows (Nova Act, browser, etc.) for cost_events insertion. */
    tool_costs?: Array<Record<string, unknown>>;
    /** Bedrock request IDs (for cost-trace linking). */
    bedrock_request_ids?: string[];
    /** Hindsight phase costs to record. */
    hindsight_usage?: Array<{
      phase: "retain" | "reflect";
      model: string;
      input_tokens: number;
      output_tokens: number;
    }>;
    /** Runtime-specific diagnostics that are safe to persist on the turn. */
    diagnostics?: Record<string, unknown>;
    /** Inline guardrail-block payload (mirrored to top-level too). */
    guardrail_block?: GuardrailBlockPayload;
    /**
     * When the agent created its assistant message via the Computer thread
     * runtime, the runtime already inserted the row + notified. Reuse that
     * messageId instead of inserting a second message. (Matches today's
     * behavior at chat-agent-invoke.ts ~line 1109.)
     */
    computer_thread_response?: {
      responseMessageId?: string;
      threadId?: string;
      messageId?: string;
    };
  };
  /** Top-level guardrail block (mirrors `response.guardrail_block`). */
  guardrail_block?: GuardrailBlockPayload;
  /** Token-usage triple that drives `recordCostEvents`. */
  usage?: {
    model?: string | null;
    input_tokens?: number;
    output_tokens?: number;
    cached_read_tokens?: number;
    diagnostics?: Record<string, unknown>;
  };
  /** Guardrail id resolved at dispatch time (when set, blocks are recorded). */
  guardrail_id?: string | null;
}

export interface GuardrailBlockPayload {
  blocked: boolean;
  type?: string;
  action?: string;
  topics?: string[];
  filters?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

/** Response shape that the finalize HTTP endpoint returns. */
export type FinalizeResponse =
  | { ok: true; idempotent: false; messageId: string | null }
  | { ok: true; idempotent: true }
  | { ok: false; error: string; code: string };
