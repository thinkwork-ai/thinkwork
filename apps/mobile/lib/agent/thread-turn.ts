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
import { workspaceContextExtension } from "./extensions/workspace-context-extension";
import { recordTurn } from "./persist-turn";
import type { ExtensionFactory } from "./extensions/types";
import type {
  AgentEvent,
  ImagePart,
  Message,
  ModelProvider,
  Tool,
} from "./types";

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
  /** Active Space id, used to load direct Space workspace context when available. */
  spaceId?: string;
  tools?: Tool[];
  /**
   * Images attached to this user message (model-vision input — e.g. a business
   * card the model reads, then calls a tool with the extracted fields). Sent on
   * the user turn via session.prompt(userText, images).
   */
  images?: ImagePart[];
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
}

export interface ThreadHarnessTurnResult {
  assistantText: string;
  ok: boolean;
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
          })
        : null,
      localBashExtension({ sessionId: input.threadId }),
      input.agentId ? mcpToolsExtension({ agentId: input.agentId }) : null,
    ].filter((ext): ext is ExtensionFactory => Boolean(ext));
  const session = createAgentSession({
    modelProvider: provider,
    systemPrompt: system,
    tools,
    extensions,
    agentName: input.agentName,
    messages: toHarnessMessages(input.priorMessages),
  });

  const unsubscribe = deps.onEvent ? session.subscribe(deps.onEvent) : null;
  const result = await session
    .prompt(input.userText, input.images)
    .finally(() => {
      unsubscribe?.();
    });
  const assistantText = result.finalText || "";

  // Persist the completed turn into the thread (append-only). A persistence failure
  // shouldn't lose the fact that the turn ran — surface via the returned ok flag.
  await record({
    threadId: input.threadId,
    userText: input.userText,
    assistantText,
    usage: result.usage,
  });

  return { assistantText, ok: result.stopReason === "completed" };
}
