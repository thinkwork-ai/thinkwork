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
import { recordTurn } from "./persist-turn";
import type { Message, ModelProvider, Tool } from "./types";

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
  tools?: Tool[];
}

export interface RunThreadHarnessTurnDeps {
  modelProvider?: ModelProvider;
  recordTurnFn?: typeof recordTurn;
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
  const session = createAgentSession({
    modelProvider: provider,
    systemPrompt: system,
    tools,
    messages: toHarnessMessages(input.priorMessages),
  });

  const result = await session.prompt(input.userText);
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
