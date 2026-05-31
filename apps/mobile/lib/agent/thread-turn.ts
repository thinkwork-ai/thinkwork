// Run a real thread turn through the on-device harness and persist it.
//
// This is what wires the RN-Pi harness into the primary thread chat: given the thread's
// existing transcript + the new user message, it runs one on-device turn (loop in Hermes →
// BedrockModelProvider → /api/model/converse → Bedrock) and persists the user+assistant
// pair to the thread via record-turn so it renders through the normal message query +
// subscription. Provider + recordTurn are injectable so this is unit-testable without the
// Expo auth module or network.

import { BedrockModelProvider } from "./providers/bedrock";
import { createAgentSession } from "./session";
import { buildTurnContext } from "./turn-context";
import {
  localBashExtension,
  type BashSnapshotStorage,
} from "./extensions/local-bash-extension";
import { mcpToolsExtension } from "./extensions/mcp-tools-extension";
import { mobileNativeExtensions } from "./extensions/mobile-native";
import { webSearchExtension } from "./extensions/web-search-extension";
import { workspaceContextExtension } from "./extensions/workspace-context-extension";
import { workspaceToolsExtension } from "./extensions/workspace-tools-extension";
import {
  buildWorkspaceBaseline,
  computeWorkspaceChangedFiles,
  type FinalizeChangedFile,
  type WorkspaceSnapshot,
} from "./workspace-diff";
import { recordTurn, type MobileSessionTurnEvidence } from "./persist-turn";
import {
  createClientTurnId,
  createMobileTurnLeaseClient,
  subscribeToAppBackground,
  type BackgroundSignalSubscribe,
  type MobileTurnLeaseClient,
} from "./turn-lease";
import {
  createWorkspaceCachePartition,
  getDefaultWorkspaceCache,
  workspaceTargetsForContext,
  type WorkspaceCache,
} from "./workspace-cache";
import type { ExtensionFactory } from "./extensions/types";
import type {
  AgentEvent,
  ImagePart,
  Message,
  ModelProvider,
  Tool,
} from "./types";
import type { MobileNativeEvidence } from "./extensions/mobile-native";

/** Loose shape of the thread's rendered messages (role + content). */
export interface PriorMessage {
  role?: string | null;
  content?: string | null;
}

export interface RunThreadHarnessTurnInput {
  threadId: string;
  userText: string;
  priorMessages: PriorMessage[];
  agentName?: string;
  /**
   * The thread's agent id — selects which tenant MCP tools the on-device agent can
   * call (via the mcp-tools extension + U2 proxy). When omitted, the turn runs with
   * no platform tools (plain chat); built-ins still apply.
   */
  agentId?: string;
  /** Current human user id, used to load the user-scoped USER.md context. */
  userId?: string;
  /** Current human display fields, used in the shared requester context. */
  userName?: string | null;
  userEmail?: string | null;
  tenantId?: string | null;
  stage?: string | null;
  /** Active Space id, used to load direct Space workspace context when available. */
  spaceId?: string;
  /**
   * Idempotency key for the platform turn lease. Callers may pass a stable value
   * when retrying the same pending send; otherwise the harness generates one.
   */
  clientTurnId?: string;
  tools?: Tool[];
  /**
   * Images attached to this user message (model-vision input — e.g. a business
   * card the model reads, then calls a tool with the extracted fields). Sent on
   * the user turn via session.prompt(userText, images).
   */
  images?: ImagePart[];
  /** Host-native attachment evidence collected by the mobile UI before the turn. */
  nativeAttachments?: MobileNativeEvidence[];
}

export interface RunThreadHarnessTurnDeps {
  modelProvider?: ModelProvider;
  turnLeaseClient?: MobileTurnLeaseClient;
  recordTurnFn?: typeof recordTurn;
  /**
   * Override the extensions loaded for the turn. Defaults to [mcpToolsExtension]
   * when `agentId` is set. Injected in tests to avoid the proxy/auth modules.
   */
  extensions?: ExtensionFactory[];
  /** Observability hook for smoke tests or future activity UI. */
  onEvent?: (event: AgentEvent) => void;
  /** Test seam for the durable rendered workspace cache. */
  workspaceCache?: WorkspaceCache;
  /** Test seam for durable local bash snapshots. */
  bashSnapshotStorage?: BashSnapshotStorage;
  /** Test seam for AppState/background subscription. */
  subscribeToBackground?: BackgroundSignalSubscribe;
  /** Test seam for heartbeat timing. */
  heartbeatIntervalMs?: number;
}

export interface ThreadHarnessTurnResult {
  assistantText: string;
  ok: boolean;
}

function fallbackAssistantText(
  stopReason: string,
  events: AgentEvent[],
): string {
  const error = events.find(
    (event): event is Extract<AgentEvent, { type: "error" }> =>
      event.type === "error",
  );
  if (error) {
    return `I encountered an error before I could complete the turn: ${error.error}`;
  }
  if (stopReason === "aborted") {
    return "This turn was canceled before I could complete a response.";
  }
  return `This turn ended before I could complete a response (${stopReason}).`;
}

function toHarnessMessages(prior: PriorMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of prior) {
    const role = (m.role ?? "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const content = m.content ?? "";
    // Coalesce consecutive same-role turns. Bedrock Converse requires strictly
    // alternating roles; adjacent same-role messages get silently concatenated
    // (producing garbled context), so merge them here with a blank-line break.
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
      continue;
    }
    out.push({ role, content });
  }
  return out;
}

function toolEvidenceIsSafe(name: string): boolean {
  return [
    "bash",
    "read",
    "grep",
    "find",
    "ls",
    "web_search",
    "mcp",
    "mobile_photo",
    "mobile_file",
    "mobile_clipboard",
  ].includes(name);
}

function checkpointForEvent(
  event: AgentEvent,
  transcript: Message[],
  eventLog: AgentEvent[],
): {
  checkpoint: Record<string, unknown>;
  message: string;
  safe: boolean;
} | null {
  const base = {
    event_type: event.type,
    transcript,
    event_log: eventLog,
  };
  switch (event.type) {
    case "agent_start":
      return {
        checkpoint: { ...base, tool_names: event.toolNames },
        message: "mobile Pi turn prepared",
        safe: true,
      };
    case "assistant_text":
      return {
        checkpoint: { ...base, text: event.text, step: event.step },
        message: "checkpoint saved",
        safe: true,
      };
    case "tool_call":
      return {
        checkpoint: {
          ...base,
          tool_call: event.call,
          step: event.step,
          unsafe_reason: "tool_call_in_flight",
        },
        message: "checkpoint saved",
        safe: false,
      };
    case "tool_result":
      return {
        checkpoint: {
          ...base,
          tool_call_id: event.toolCallId,
          name: event.name,
          result: event.result,
          step: event.step,
        },
        message: "checkpoint saved",
        safe: toolEvidenceIsSafe(event.name) && !event.result.isError,
      };
    case "agent_end":
      return {
        checkpoint: {
          ...base,
          stop_reason: event.stopReason,
          steps: event.steps,
          usage: event.usage,
        },
        message: "checkpoint saved",
        safe: true,
      };
    case "done":
      return {
        checkpoint: {
          ...base,
          stop_reason: event.stopReason,
          steps: event.steps,
        },
        message: "checkpoint saved",
        safe: true,
      };
    case "error":
      return {
        checkpoint: { ...base, error: event.error },
        message: "checkpoint saved",
        safe: true,
      };
    case "after_tool_call":
      return null;
  }
}

function attachmentRefs(
  input: RunThreadHarnessTurnInput,
): { name?: string; mimeType?: string; sizeBytes?: number }[] {
  return [
    ...(input.nativeAttachments ?? []).map((attachment) => ({
      name: attachment.name,
      mimeType: attachment.mimeType ?? undefined,
      sizeBytes: attachment.sizeBytes ?? undefined,
    })),
    ...(input.images ?? []).map((image, index) => ({
      name: `image-${index + 1}.${image.format}`,
      mimeType: `image/${image.format}`,
      sizeBytes: Math.ceil((image.data.length * 3) / 4),
    })),
  ];
}

export async function runThreadHarnessTurn(
  input: RunThreadHarnessTurnInput,
  deps: RunThreadHarnessTurnDeps = {},
): Promise<ThreadHarnessTurnResult> {
  const provider = deps.modelProvider ?? new BedrockModelProvider();
  const useLegacyRecord = Boolean(deps.recordTurnFn) && !deps.turnLeaseClient;
  const record = deps.recordTurnFn ?? recordTurn;
  const lease = deps.turnLeaseClient ?? createMobileTurnLeaseClient();

  const { system, tools } = buildTurnContext({
    agentName: input.agentName,
    tools: input.tools,
  });
  const workspaceTargets = workspaceTargetsForContext(input);
  const workspaceCache = deps.workspaceCache ?? getDefaultWorkspaceCache();
  const workspacePartition = createWorkspaceCachePartition({
    stage: input.stage,
    tenantId: input.tenantId,
    agentId: input.agentId,
    spaceId: input.spaceId,
    userId: input.userId,
  });
  const workspaceReader =
    workspaceTargets.length > 0
      ? {
          getWorkspaceFile: async (_target: unknown, path: string) => {
            await workspaceCache.sync({
              partition: workspacePartition,
              targets: workspaceTargets,
            });
            const file = await workspaceCache.readFile(
              workspacePartition,
              path,
            );
            return {
              content: file?.content ?? null,
              source: file?.source ?? "cache",
              sha256: file?.sha256 ?? "",
            };
          },
        }
      : undefined;
  let bashWorkspaceBaseline:
    | ReturnType<typeof buildWorkspaceBaseline>
    | undefined;
  let bashWorkspaceCurrent: WorkspaceSnapshot | undefined;
  const captureBashWorkspaceSnapshot = (
    phase: "baseline" | "current",
    files: WorkspaceSnapshot,
  ) => {
    if (phase === "baseline" && !bashWorkspaceBaseline) {
      bashWorkspaceBaseline = buildWorkspaceBaseline({ snapshot: files });
      bashWorkspaceCurrent = files;
      return;
    }
    if (phase === "current") {
      bashWorkspaceCurrent = files;
    }
  };
  // The agent's tenant MCP tools arrive as the first Pi-style extension. Default
  // when an agentId is known; tests inject their own (or none). Built-ins/`tools`
  // are preserved — extensions are additive.
  const extensions =
    deps.extensions ??
    [
      input.userId || input.agentId || input.spaceId
        ? workspaceContextExtension({
            userId: input.userId,
            userName: input.userName,
            userEmail: input.userEmail,
            agentId: input.agentId,
            spaceId: input.spaceId,
            deps: workspaceReader,
          })
        : null,
      workspaceTargets.length > 0
        ? workspaceToolsExtension({
            cache: workspaceCache,
            partition: workspacePartition,
            targets: workspaceTargets,
          })
        : null,
      localBashExtension({
        sessionId: input.threadId,
        onWorkspaceSnapshot: captureBashWorkspaceSnapshot,
        snapshotStorage: deps.bashSnapshotStorage,
        workspace:
          workspaceTargets.length > 0
            ? {
                cache: workspaceCache,
                partition: workspacePartition,
                targets: workspaceTargets,
              }
            : undefined,
      }),
      ...mobileNativeExtensions(),
      input.agentId ? webSearchExtension({ agentId: input.agentId }) : null,
      input.agentId ? mcpToolsExtension({ agentId: input.agentId }) : null,
    ].filter((ext): ext is ExtensionFactory => Boolean(ext));
  const session = createAgentSession({
    modelProvider: provider,
    systemPrompt: system,
    tools,
    extensions,
    agentName: input.agentName,
    sessionId: input.threadId,
    messages: toHarnessMessages(input.priorMessages),
  });

  const events: AgentEvent[] = [];
  const clientTurnId = input.clientTurnId ?? createClientTurnId();
  let threadTurnId: string | null = null;
  let latestCheckpointSeq = 0;
  let checkpointQueue: Promise<void> = Promise.resolve();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeBackground: (() => void) | null = null;

  if (!useLegacyRecord) {
    const started = await lease.start({
      clientTurnId,
      threadId: input.threadId,
      agentId: input.agentId,
      userText: input.userText,
      attachments: attachmentRefs(input),
      metadata: {
        agent_name: input.agentName ?? null,
        user_id: input.userId ?? null,
        user_name: input.userName ?? null,
        user_email: input.userEmail ?? null,
        tenant_id: input.tenantId ?? null,
        space_id: input.spaceId ?? null,
        stage: input.stage ?? null,
      },
    });
    threadTurnId = started.threadTurnId;
    latestCheckpointSeq = started.checkpointSeq;

    heartbeatTimer = setInterval(() => {
      void lease
        .heartbeat({
          threadTurnId: started.threadTurnId,
          latestCheckpointSeq,
        })
        .catch((err) => console.warn("[mobile-pi] heartbeat failed", err));
    }, deps.heartbeatIntervalMs ?? 5000);

    const subscribe = deps.subscribeToBackground ?? subscribeToAppBackground;
    unsubscribeBackground = subscribe((reason) => {
      void lease
        .background({ threadTurnId: started.threadTurnId, reason })
        .catch((err) =>
          console.warn("[mobile-pi] background signal failed", err),
        );
    });
  }

  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    deps.onEvent?.(event);
    if (!threadTurnId || useLegacyRecord) return;
    const checkpoint = checkpointForEvent(event, session.messages, [...events]);
    if (!checkpoint) return;
    checkpointQueue = checkpointQueue
      .then(async () => {
        const saved = await lease.checkpoint({
          threadTurnId: threadTurnId!,
          ...checkpoint,
        });
        latestCheckpointSeq = saved.seq;
      })
      .catch((err) => console.warn("[mobile-pi] checkpoint failed", err));
  });
  let result;
  try {
    result = await session.prompt(input.userText, input.images);
    await checkpointQueue;
  } catch (err) {
    if (!useLegacyRecord && threadTurnId) {
      await lease.abort({
        threadTurnId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  } finally {
    unsubscribe();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    unsubscribeBackground?.();
  }
  const assistantText =
    result.finalText || fallbackAssistantText(result.stopReason, events);
  const evidence: MobileSessionTurnEvidence = {
    type: "mobile_session",
    stopReason: result.stopReason,
    transcript: result.messages,
    events,
    attachments: [
      ...(input.nativeAttachments ?? []),
      ...(input.images ?? []).map((image, index) => ({
        type: "mobile_native_capability" as const,
        source: "photo_library" as const,
        name: `image-${index + 1}.${image.format}`,
        mimeType: `image/${image.format}`,
        sizeBytes: Math.ceil((image.data.length * 3) / 4),
        textExtracted: false,
      })),
    ],
  };
  const changedFiles: FinalizeChangedFile[] =
    bashWorkspaceBaseline && bashWorkspaceCurrent
      ? computeWorkspaceChangedFiles({
          baseline: bashWorkspaceBaseline,
          current: bashWorkspaceCurrent,
        })
      : [];

  if (useLegacyRecord) {
    // Compatibility path for older callers/tests. The default mobile harness
    // path uses the platform-owned turn lease above.
    await record({
      threadId: input.threadId,
      userText: input.userText,
      assistantText,
      toolResults: [evidence],
      usage: result.usage,
    });
  } else if (threadTurnId) {
    if (result.stopReason === "aborted") {
      await lease.abort({ threadTurnId, reason: "local_abort" });
      return { assistantText, ok: false };
    }
    try {
      await lease.finalize({
        threadTurnId,
        assistantText,
        toolResults: [evidence],
        usage: result.usage,
        changedFiles,
        diagnostics: { clientTurnId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("409") || message.includes("FINALIZE_REJECTED")) {
        return { assistantText, ok: false };
      }
      throw err;
    }
  }

  return { assistantText, ok: result.stopReason === "completed" };
}
