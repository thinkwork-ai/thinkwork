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
import { localBashExtension } from "./extensions/local-bash-extension";
import { mcpToolsExtension } from "./extensions/mcp-tools-extension";
import { mobileNativeExtensions } from "./extensions/mobile-native";
import { webSearchExtension } from "./extensions/web-search-extension";
import { workspaceContextExtension } from "./extensions/workspace-context-extension";
import { workspaceToolsExtension } from "./extensions/workspace-tools-extension";
import { recordTurn, type MobileSessionTurnEvidence } from "./persist-turn";
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

export async function runThreadHarnessTurn(
  input: RunThreadHarnessTurnInput,
  deps: RunThreadHarnessTurnDeps = {},
): Promise<ThreadHarnessTurnResult> {
  const provider = deps.modelProvider ?? new BedrockModelProvider();
  const record = deps.recordTurnFn ?? recordTurn;

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
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    deps.onEvent?.(event);
  });
  const result = await session
    .prompt(input.userText, input.images)
    .finally(() => {
      unsubscribe();
    });
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

  // Persist the completed turn into the thread (append-only). A persistence failure
  // shouldn't lose the fact that the turn ran — surface via the returned ok flag.
  await record({
    threadId: input.threadId,
    userText: input.userText,
    assistantText,
    toolResults: [evidence],
    usage: result.usage,
  });

  return { assistantText, ok: result.stopReason === "completed" };
}
