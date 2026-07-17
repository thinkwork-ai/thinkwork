/**
 * Harness invocation runner (THINK-311 U5).
 *
 * Consumes the SAME chat invoke payload the Pi container receives (the
 * dispatch selector routes a harness-flagged agent's Event-mode invoke to
 * the harness-runner Lambda instead of the Pi Lambda — no second payload
 * builder), and performs the real run:
 *
 *   projection (U3) → ensure harness (control plane) → InvokeHarness
 *   stream loop → caller-fulfilled emit_document via handleDocumentEmission
 *   → processFinalize with a complete FinalizePayload.
 *
 * Failure semantics (KTD-4/KTD-9): every exit path finalizes the turn —
 * projection rejections, stream failures, SDK exceptions, and abandonment
 * all land as an explicit failed turn through processFinalize's
 * finalized_at CAS. A keepalive bumps thread_turns.last_activity_at while
 * streaming so the 5-minute stall monitor never kills a live Harness turn;
 * stall-killed harness turns are excluded from retry re-dispatch at the
 * enqueue site (see stall-monitor.ts) so the reconciler can never become a
 * silent Pi fallback (R4).
 *
 * All AWS/db/platform effects are injected (HarnessRunnerDeps) so the loop
 * is unit-testable against a scripted stream.
 */

import {
  projectHarnessConfig,
  type HarnessProjectedConfig,
  type HarnessProjectionInput,
  type HarnessProjectionRejection,
} from "./projection.js";
import {
  buildEmitDocumentToolProjection,
  relayEmissionResultToModel,
  toEmissionRaw,
} from "./emit-document-tool.js";
import type { FinalizePayload } from "../chat-finalize/types.js";
import type {
  McpConfig,
  SkillConfig,
} from "../resolve-agent-runtime-config.js";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface EnsuredHarness {
  harnessArn: string;
  harnessId: string;
  /** Version string/number as reported by the control plane (evidence). */
  harnessVersion: string;
}

/** Minimal projection of the InvokeHarness stream events the loop consumes. */
export interface HarnessStreamEvent {
  messageStart?: { role?: string };
  contentBlockStart?: {
    contentBlockIndex: number;
    start?: { toolUse?: { toolUseId: string; name: string; type?: string } };
  };
  contentBlockDelta?: {
    contentBlockIndex: number;
    delta?: { text?: string; toolUse?: { input?: string } };
  };
  contentBlockStop?: { contentBlockIndex: number };
  messageStop?: { stopReason: string };
  metadata?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheWriteInputTokens?: number;
    };
  };
  runtimeClientError?: { message?: string };
  internalServerException?: { message?: string };
  validationException?: { message?: string; reason?: string };
}

export interface HarnessInvokeMessage {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
}

export interface HarnessRunnerDeps {
  /**
   * Ensure a harness exists matching the projected config (create or
   * update by harnessName) and return its identity. Implemented with the
   * control-plane SDK in the handler; scripted in tests.
   */
  ensureHarness(
    config: HarnessProjectedConfig,
    executionRoleArn: string,
  ): Promise<EnsuredHarness>;
  /** One InvokeHarness call; returns the event stream. */
  invokeHarness(input: {
    harnessArn: string;
    runtimeSessionId: string;
    runtimeUserId?: string;
    messages: HarnessInvokeMessage[];
  }): Promise<AsyncIterable<HarnessStreamEvent>>;
  /** Direct lib call into the existing document emission pipeline. */
  emitDocument(input: {
    tenantId: string;
    threadId: string;
    agentId: string | null;
    turnId: string;
    raw: Record<string, unknown>;
  }): Promise<{ statusCode: number; body: Record<string, unknown> }>;
  /** Direct lib call into processFinalize. */
  finalize(payload: FinalizePayload): Promise<unknown>;
  /** thread_turns.last_activity_at keepalive bump (KTD-9). */
  bumpTurnActivity(input: { turnId: string; tenantId: string }): Promise<void>;
  /** Read a text file from the workspace bucket; null when absent. */
  fetchWorkspaceText(key: string): Promise<string | null>;
  /** Model-catalog provider lookup ("bedrock" | other | null). */
  resolveModelProvider(input: {
    tenantId: string;
    modelId: string;
  }): Promise<string | null>;
  executionRoleArn: string;
  workspaceBucket: string;
  keepaliveIntervalMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Payload extraction
// ---------------------------------------------------------------------------

/**
 * Unwrap the API-Gateway-v2-shaped Event payload the dispatcher sends
 * (the same wrapper the Pi container's /invocations endpoint receives).
 */
export function parseHarnessInvokeEvent(
  event: unknown,
): Record<string, unknown> {
  const record = (event ?? {}) as Record<string, unknown>;
  if (typeof record.body === "string") {
    return JSON.parse(record.body) as Record<string, unknown>;
  }
  if (record.body && typeof record.body === "object") {
    return record.body as Record<string, unknown>;
  }
  return record;
}

interface ExtractedTurn {
  tenantId: string;
  threadId: string;
  agentId: string;
  turnId: string;
  traceId: string | undefined;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  modelId: string | null;
  agentSlug: string | null;
  agentName: string | null;
  costOwnerUserId: string | null;
  currentUserId: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractTurn(payload: Record<string, unknown>): ExtractedTurn {
  const tenantId = str(payload.tenant_id);
  const threadId = str(payload.thread_id);
  const agentId = str(payload.assistant_id);
  const turnId = str(payload.thread_turn_id);
  if (!tenantId || !threadId || !agentId || !turnId) {
    throw new Error(
      "harness-runner payload missing tenant_id/thread_id/assistant_id/thread_turn_id",
    );
  }
  const history = Array.isArray(payload.messages_history)
    ? (payload.messages_history as Array<Record<string, unknown>>)
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.length > 0,
        )
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        }))
    : [];
  return {
    tenantId,
    threadId,
    agentId,
    turnId,
    traceId: str(payload.trace_id) ?? undefined,
    userMessage: str(payload.message) ?? "",
    history,
    modelId: str(payload.model),
    agentSlug: str(payload.instance_id),
    agentName: str(payload.agent_name),
    costOwnerUserId: str(payload.cost_owner_user_id),
    currentUserId: str(payload.user_id),
  };
}

// ---------------------------------------------------------------------------
// System prompt composition
// ---------------------------------------------------------------------------

/**
 * Mirror the Pi container's prompt assembly from the rendered thread
 * workspace: AGENTS.md + CONTEXT.md + GUARDRAILS.md + User/USER.md, plus
 * the SCHEMA.md of each projected connector (the reference run read it via
 * the Pi `read` tool, which Harness does not have). Falls back to the
 * payload's raw system_prompt when the rendered prefix is unavailable.
 */
export async function composeHarnessSystemPrompt(
  payload: Record<string, unknown>,
  mcpConfigs: McpConfig[],
  deps: Pick<HarnessRunnerDeps, "fetchWorkspaceText">,
): Promise<string> {
  const prefix = str(payload.rendered_workspace_prefix);
  const fallback = str(payload.system_prompt) ?? "";
  if (!prefix) return fallback;
  const cleanPrefix = prefix.replace(/\/+$/, "");
  const sections: string[] = [];
  const rootFiles = [
    "AGENTS.md",
    "CONTEXT.md",
    "GUARDRAILS.md",
    "User/USER.md",
  ];
  for (const file of rootFiles) {
    const text = await deps.fetchWorkspaceText(`${cleanPrefix}/${file}`);
    if (text?.trim()) sections.push(text.trim());
  }
  for (const mcp of mcpConfigs) {
    if (!mcp.name) continue;
    const schema =
      (await deps.fetchWorkspaceText(
        `${cleanPrefix}/connectors/${mcp.name}/SCHEMA.md`,
      )) ??
      (await deps.fetchWorkspaceText(
        `${cleanPrefix}/connections/${mcp.name}/SCHEMA.md`,
      ));
    if (schema?.trim()) {
      sections.push(
        `# Connector schema reference: ${mcp.name}\n\n${schema.trim()}`,
      );
    }
  }
  if (sections.length === 0) return fallback;
  return sections.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Stream assembly
// ---------------------------------------------------------------------------

interface AssembledToolUse {
  toolUseId: string;
  name: string;
  input: unknown;
  inputRaw: string;
  parseError?: string;
}

interface AssembledSegment {
  text: string;
  toolUses: AssembledToolUse[];
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

export class HarnessStreamError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "HarnessStreamError";
  }
}

type AssembledBlock = {
  kind: "text" | "toolUse";
  text: string;
  toolUseId?: string;
  name?: string;
  inputJson: string;
};

type AssembledMessage = {
  role: string;
  blocks: Map<number, AssembledBlock>;
};

async function assembleStream(
  stream: AsyncIterable<HarnessStreamEvent>,
  onActivity: () => void,
): Promise<AssembledSegment> {
  // One InvokeHarness stream can carry SEVERAL messages: the harness runs
  // its internal loop (built-in tool use + tool results) and only ends the
  // stream when the CALLER must act. contentBlockIndex restarts per
  // message, so blocks must be tracked per message — a single flat map
  // leaks internally-fulfilled toolUses into the caller relay, and Bedrock
  // then rejects the continuation with "toolResult blocks exceed toolUse
  // blocks of previous turn" (observed live, THINK-311 turn #12).
  const messages: AssembledMessage[] = [];
  const currentMessage = (): AssembledMessage => {
    if (messages.length === 0) {
      messages.push({ role: "assistant", blocks: new Map() });
    }
    return messages[messages.length - 1];
  };
  const segment: AssembledSegment = {
    text: "",
    toolUses: [],
    stopReason: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
  for await (const event of stream) {
    onActivity();
    if (event.runtimeClientError) {
      throw new HarnessStreamError(
        "runtime_client_error",
        event.runtimeClientError.message ?? "Harness runtimeClientError",
      );
    }
    if (event.internalServerException) {
      throw new HarnessStreamError(
        "internal_server_exception",
        event.internalServerException.message ?? "Harness internal error",
      );
    }
    if (event.validationException) {
      throw new HarnessStreamError(
        "validation_exception",
        `${event.validationException.reason ?? "ValidationException"}: ${event.validationException.message ?? ""}`,
      );
    }
    if (event.messageStart) {
      messages.push({
        role: event.messageStart.role ?? "assistant",
        blocks: new Map(),
      });
      continue;
    }
    if (event.contentBlockStart) {
      const { contentBlockIndex, start } = event.contentBlockStart;
      const blocks = currentMessage().blocks;
      if (start?.toolUse) {
        blocks.set(contentBlockIndex, {
          kind: "toolUse",
          text: "",
          toolUseId: start.toolUse.toolUseId,
          name: start.toolUse.name,
          inputJson: "",
        });
      } else {
        blocks.set(contentBlockIndex, {
          kind: "text",
          text: "",
          inputJson: "",
        });
      }
      continue;
    }
    if (event.contentBlockDelta) {
      const { contentBlockIndex, delta } = event.contentBlockDelta;
      const blocks = currentMessage().blocks;
      const block = blocks.get(contentBlockIndex) ?? {
        kind: "text" as const,
        text: "",
        inputJson: "",
      };
      if (delta?.text) block.text += delta.text;
      if (delta?.toolUse?.input) {
        block.kind = "toolUse";
        block.inputJson += delta.toolUse.input;
      }
      blocks.set(contentBlockIndex, block);
      continue;
    }
    if (event.messageStop) {
      segment.stopReason = event.messageStop.stopReason;
      continue;
    }
    if (event.metadata?.usage) {
      const usage = event.metadata.usage;
      segment.usage.inputTokens += usage.inputTokens ?? 0;
      segment.usage.outputTokens += usage.outputTokens ?? 0;
      segment.usage.cacheReadTokens += usage.cacheReadInputTokens ?? 0;
      segment.usage.cacheWriteTokens += usage.cacheWriteInputTokens ?? 0;
    }
  }
  // Visible text: concatenation of every assistant message's text blocks.
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const [, block] of [...message.blocks.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      if (block.kind === "text") segment.text += block.text;
    }
  }
  // Caller-fulfilled toolUses: ONLY the final assistant message's — the
  // stream ends exactly where the harness needs the caller; everything
  // earlier was fulfilled inside the harness loop.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  for (const [, block] of [...(lastAssistant?.blocks.entries() ?? [])].sort(
    (a, b) => a[0] - b[0],
  )) {
    if (block.kind !== "toolUse") continue;
    if (!block.toolUseId || !block.name) continue;
    let input: unknown = undefined;
    let parseError: string | undefined;
    if (block.inputJson.trim()) {
      try {
        input = JSON.parse(block.inputJson);
      } catch (err) {
        parseError = `malformed tool input JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      input = {};
    }
    segment.toolUses.push({
      toolUseId: block.toolUseId,
      name: block.name,
      input,
      inputRaw: block.inputJson,
      parseError,
    });
  }
  return segment;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const CONTINUE_STOP_REASONS = new Set([
  "tool_use",
  "tool_result",
  "partial_turn",
]);
const MAX_TOOL_ROUNDS = 16;

/** Payload features the trial's chat-only adapter refuses up front. */
const UNSUPPORTED_PAYLOAD_FIELDS: Array<[string, string]> = [
  ["computer_task_id", "computer task turns"],
  ["goal_mode", "goal mode"],
  ["skill_creator_command", "skill-creator command turns"],
  ["pending_user_questions", "question-answer resume turns"],
  ["pinned_skills", "message-pinned skills"],
];

export async function runHarnessTurn(
  payload: Record<string, unknown>,
  deps: HarnessRunnerDeps,
): Promise<{ status: "completed" | "failed" }> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const turn = extractTurn(payload);

  const toolInvocations: Array<Record<string, unknown>> = [];
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let lastArtifactId: string | null = null;
  let lastDocumentId: string | null = null;
  let emissionAttempts = 0;
  let emissionSuccesses = 0;
  let harness: EnsuredHarness | null = null;
  let projected: HarnessProjectedConfig | null = null;
  let composedSystemPrompt: string | null = null;

  const finalizeWith = async (
    status: "completed" | "failed",
    fields: { content?: string; errorMessage?: string },
  ) => {
    const finalizePayload: FinalizePayload = {
      thread_turn_id: turn.turnId,
      tenant_id: turn.tenantId,
      agent_id: turn.agentId,
      thread_id: turn.threadId,
      trace_id: turn.traceId,
      cost_owner_user_id: turn.costOwnerUserId,
      user_message: turn.userMessage.slice(0, 2000),
      agent_model: turn.modelId,
      runtime_type: "harness",
      agent_slug: turn.agentSlug,
      agent_name: turn.agentName,
      duration_ms: now() - startedAt,
      status,
      ...(fields.errorMessage ? { error_message: fields.errorMessage } : {}),
      changed_files: [],
      composed_system_prompt: composedSystemPrompt,
      response: {
        content: fields.content ?? "",
        runtime: "harness",
        tool_invocations: toolInvocations,
        tools_called: [
          ...new Set(toolInvocations.map((t) => String(t.tool_name ?? ""))),
        ].filter(Boolean),
        diagnostics: {
          harness: {
            harness_id: harness?.harnessId ?? null,
            harness_arn: harness?.harnessArn ?? null,
            harness_version: harness?.harnessVersion ?? null,
            projection_fingerprint:
              projected?.evidence.projectionFingerprint ?? null,
            manifest_fingerprint:
              projected?.evidence.manifestFingerprint ??
              str(payload.capabilities_manifest_fingerprint),
            config_fingerprint:
              projected?.evidence.configFingerprint ??
              str(payload.config_fingerprint),
            exclusions: projected?.evidence.exclusions ?? [],
            artifact_id: lastArtifactId,
            document_id: lastDocumentId,
            emission_attempts: emissionAttempts,
            emission_successes: emissionSuccesses,
          },
        },
      },
      usage: {
        model: turn.modelId,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_read_tokens: usage.cacheReadTokens,
        cached_write_tokens: usage.cacheWriteTokens,
      },
    };
    await deps.finalize(finalizePayload);
    return { status } as const;
  };

  // KTD-9 keepalive: bump last_activity_at so the stall monitor never
  // selects a live harness turn. Errors are swallowed — a failed bump must
  // not kill the run; the stall monitor's enqueue-side exclusion is the
  // backstop.
  let lastBump = 0;
  const keepaliveMs = deps.keepaliveIntervalMs ?? 60_000;
  const onActivity = () => {
    const at = now();
    if (at - lastBump < keepaliveMs) return;
    lastBump = at;
    void deps
      .bumpTurnActivity({ turnId: turn.turnId, tenantId: turn.tenantId })
      .catch((err) =>
        console.warn(`[harness-runner] keepalive bump failed:`, err),
      );
  };

  try {
    for (const [field, label] of UNSUPPORTED_PAYLOAD_FIELDS) {
      const value = payload[field];
      const present = Array.isArray(value) ? value.length > 0 : value != null;
      if (present) {
        return await finalizeWith("failed", {
          errorMessage: `Harness trial rejection [adapter_unimplemented] ${field}: ${label} are outside the trial's chat-only scope (KTD-7).`,
        });
      }
    }

    const mcpConfigs = (
      Array.isArray(payload.mcp_configs) ? payload.mcp_configs : []
    ) as McpConfig[];
    const skills = (
      Array.isArray(payload.skills) ? payload.skills : []
    ) as SkillConfig[];
    const agentProfiles = Array.isArray(payload.agent_profiles)
      ? (payload.agent_profiles as Array<Record<string, unknown>>)
      : [];
    const piExtensions = Array.isArray(payload.pi_extensions)
      ? payload.pi_extensions
      : [];
    const attachments = Array.isArray(payload.message_attachments)
      ? payload.message_attachments
      : [];

    composedSystemPrompt = await composeHarnessSystemPrompt(
      payload,
      mcpConfigs,
      deps,
    );

    const modelProvider = turn.modelId
      ? await deps.resolveModelProvider({
          tenantId: turn.tenantId,
          modelId: turn.modelId,
        })
      : null;

    const emitTool = buildEmitDocumentToolProjection(payload.document_plates);

    const projectionInput: HarnessProjectionInput = {
      tenantId: turn.tenantId,
      agentId: turn.agentId,
      agentSlug: turn.agentSlug ?? "agent",
      systemPrompt: composedSystemPrompt,
      modelId: turn.modelId,
      modelProvider,
      skills,
      mcpConfigs,
      manifestFingerprint: str(payload.capabilities_manifest_fingerprint),
      configFingerprint: str(payload.config_fingerprint),
      emitDocument: emitTool,
      workspaceBucket: deps.workspaceBucket,
      capabilitySurface: {
        piExtensionCount: piExtensions.length,
        agentProfileSlugs: agentProfiles
          .map((p) => str(p.slug))
          .filter((slug): slug is string => Boolean(slug)),
        browserAutomationEnabled: payload.browser_automation_enabled === true,
        sandboxConfigured: payload.sandbox_status != null,
        guardrailConfigured: payload.guardrail_config != null,
        sendEmailEnabled: payload.send_email_config != null,
        webSearchEnabled: payload.web_search_config != null,
        webExtractEnabled: payload.web_extract_config != null,
        contextEngineEnabled: payload.context_engine_enabled === true,
        jsonRenderUiEnabled: payload.thread_json_render_ui_enabled === true,
        knowledgeGraphEnabled: payload.knowledge_graph_enabled === true,
        attachmentCount: attachments.length,
      },
    };

    const projection = projectHarnessConfig(projectionInput);
    if (!projection.ok) {
      return await finalizeWith("failed", {
        errorMessage: formatRejection(projection.rejection),
      });
    }
    projected = projection.config;

    harness = await deps.ensureHarness(projected, deps.executionRoleArn);
    onActivity();

    // Session id: thread-derived, stable across tool round-trips, ≥33 chars.
    const runtimeSessionId = `tw-harness-${turn.threadId}`;

    let nextMessages: HarnessInvokeMessage[] = [
      ...turn.history.map(
        (m): HarnessInvokeMessage => ({
          role: m.role,
          content: [{ text: m.content }],
        }),
      ),
      { role: "user", content: [{ text: turn.userMessage }] },
    ];

    let finalText = "";
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (round === MAX_TOOL_ROUNDS) {
        return await finalizeWith("failed", {
          errorMessage: `Harness run exceeded ${MAX_TOOL_ROUNDS} caller-fulfilled tool rounds without terminating.`,
        });
      }
      const stream = await deps.invokeHarness({
        harnessArn: harness.harnessArn,
        runtimeSessionId,
        runtimeUserId: turn.currentUserId ?? undefined,
        messages: nextMessages,
      });
      const segment = await assembleStream(stream, onActivity);
      usage.inputTokens += segment.usage.inputTokens;
      usage.outputTokens += segment.usage.outputTokens;
      usage.cacheReadTokens += segment.usage.cacheReadTokens;
      usage.cacheWriteTokens += segment.usage.cacheWriteTokens;
      if (segment.text.trim()) finalText = segment.text;

      const callerToolUses = segment.toolUses;
      if (segment.stopReason === "end_turn" && callerToolUses.length === 0) {
        // pi-ai silent-validation analog: empty content + zero tokens is a
        // swallowed model failure, never a legitimate completion.
        if (
          !finalText.trim() &&
          emissionSuccesses === 0 &&
          usage.outputTokens === 0
        ) {
          return await finalizeWith("failed", {
            errorMessage:
              "Harness stream ended with empty content and zero output tokens (swallowed model failure).",
          });
        }
        if (emissionAttempts > 0 && emissionSuccesses === 0) {
          // Never a false pass (AE2): the model tried to emit, every
          // attempt was rejected, and the run ended anyway.
          return await finalizeWith("failed", {
            errorMessage: `Harness run ended without a successful document emission after ${emissionAttempts} rejected emit_document attempt(s).`,
          });
        }
        return await finalizeWith("completed", { content: finalText });
      }

      if (
        callerToolUses.length > 0 &&
        (segment.stopReason === null ||
          CONTINUE_STOP_REASONS.has(segment.stopReason) ||
          segment.stopReason === "end_turn")
      ) {
        const resultBlocks: Array<Record<string, unknown>> = [];
        for (const toolUse of callerToolUses) {
          const startedTool = now();
          let resultText: string;
          let resultStatus: "success" | "error";
          if (toolUse.parseError) {
            resultText = toolUse.parseError;
            resultStatus = "error";
          } else if (toolUse.name !== "emit_document") {
            resultText = `Unknown caller-fulfilled tool "${toolUse.name}" — only emit_document is available.`;
            resultStatus = "error";
          } else {
            emissionAttempts += 1;
            const emission = await deps.emitDocument({
              tenantId: turn.tenantId,
              threadId: turn.threadId,
              agentId: turn.agentId,
              turnId: turn.turnId,
              raw: toEmissionRaw(toolUse.input),
            });
            const relay = relayEmissionResultToModel(emission);
            resultText = relay.text;
            resultStatus = relay.status;
            if (relay.status === "success") {
              emissionSuccesses += 1;
              lastArtifactId = relay.artifactId ?? lastArtifactId;
              lastDocumentId = relay.documentId ?? lastDocumentId;
            }
            if (relay.fatal) {
              toolInvocations.push({
                tool_name: toolUse.name,
                status: "failed",
                duration_ms: now() - startedTool,
                result_summary: resultText.slice(0, 500),
              });
              return await finalizeWith("failed", {
                errorMessage: `emit_document fulfillment failed fatally: ${relay.text}`,
              });
            }
          }
          toolInvocations.push({
            tool_name: toolUse.name,
            status: resultStatus === "success" ? "completed" : "rejected",
            duration_ms: now() - startedTool,
            result_summary: resultText.slice(0, 500),
          });
          resultBlocks.push({
            toolResult: {
              toolUseId: toolUse.toolUseId,
              status: resultStatus,
              content: [{ text: resultText }],
            },
          });
        }
        nextMessages = [{ role: "user", content: resultBlocks }];
        continue;
      }

      // Any other terminal stopReason (max_iterations_exceeded,
      // timeout_exceeded, content_filtered, malformed_*, interrupted,
      // max_tokens...) — explicit failure naming the cause (KTD-4).
      return await finalizeWith("failed", {
        errorMessage: `Harness run stopped with stopReason "${segment.stopReason ?? "none"}" (not a successful end_turn).`,
      });
    }
    // Unreachable — the loop always returns.
    return await finalizeWith("failed", {
      errorMessage: "Harness run loop exited unexpectedly.",
    });
  } catch (err) {
    const message =
      err instanceof HarnessStreamError
        ? `Harness stream failure [${err.reason}]: ${err.message}`
        : `Harness run failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[harness-runner] ${message}`);
    try {
      return await finalizeWith("failed", { errorMessage: message });
    } catch (finalizeErr) {
      // finalize-through-failure itself failed — the stall monitor will
      // time the turn out and release the thread checkout (KTD-9 backstop).
      console.error(
        `[harness-runner] finalize-through-failure failed:`,
        finalizeErr,
      );
      throw err;
    }
  }
}

function formatRejection(rejection: HarnessProjectionRejection): string {
  return `Harness projection rejected [${rejection.kind}] ${rejection.capability}: ${rejection.detail}`;
}
