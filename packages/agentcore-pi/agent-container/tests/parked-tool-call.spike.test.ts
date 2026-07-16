/**
 * THINK-302 U10 — parked-call resume spike (Milestone B de-risk of R12/R13).
 *
 * Question: can a pi-ai/pi-agent-core session persist an assistant message
 * that ends in an UNFINISHED `tool_use`, survive a process restart (JSONL
 * round-trip, as the S3 durable session does), and resume by injecting a
 * real `tool_result` — continuing the SAME logical turn coherently — both
 * with and without an interleaved normal turn between park and resume?
 *
 * The spike drives the ACTUAL library primitives the runtime uses:
 *   - `convertToLlm` (pi-agent-core harness) — the LLM-call-boundary
 *     transform that auto-closes dangling tool calls (the hazard AND the
 *     enabling mechanism).
 *   - `runAgentLoopContinue` (pi-agent-core) with a scripted `streamFn` —
 *     the "resume from tool results without a new user message" entry.
 *
 * Persistence is modeled as raw JSONL round-trip of the message array (what
 * `durable-session-manager.persist()` writes to S3), so "restart" = parse
 * the serialized transcript in a fresh object graph.
 *
 * Verdict is asserted by the tests themselves (spike-as-test); the written
 * conclusion lands in U12's approach. See the trailing VERDICT block.
 */

import { describe, expect, it } from "vitest";
import type {
  AssistantMessage,
  Message,
  Model,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  convertToLlm,
  runAgentLoopContinue,
} from "@earendil-works/pi-agent-core";

// ── fixtures ────────────────────────────────────────────────────────────────

const CALL_ID = "toolu_parked_dagster_launch";

/** An assistant message that emitted a tool call and stopped there (parked). */
function parkedAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "Launching the pipeline." },
      {
        type: "toolCall",
        id: CALL_ID,
        name: "dagster_launch_run",
        arguments: { pipeline: "nightly_etl" },
      },
    ],
    stopReason: "toolUse",
    usage: {
      input: 42,
      output: 12,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 54,
    },
  } as unknown as AssistantMessage;
}

/** The real tool result an operator approval unblocks (the injected resume). */
function approvedToolResult(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: CALL_ID,
    toolName: "dagster_launch_run",
    content: [{ type: "text", text: "run_id=run_9f3a launched" }],
    isError: false,
  } as unknown as ToolResultMessage;
}

function userMessage(text: string): Message {
  return { role: "user", content: text } as unknown as Message;
}

function assistantText(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: {
      input: 5,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10,
    },
  } as unknown as AssistantMessage;
}

/** Raw JSONL round-trip — models durable-session persist()/open() over S3. */
function persistRestart(messages: AgentMessage[]): AgentMessage[] {
  const jsonl = messages
    .map((message) => JSON.stringify({ type: "message", message }))
    .join("\n");
  return jsonl
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).message as AgentMessage);
}

function toolResultBlockCount(messages: Message[], callId: string): number {
  let count = 0;
  for (const message of messages) {
    if ((message as { role: string }).role === "user") {
      const content = (message as { content: unknown }).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "tool_result" &&
            (part as { toolCallId?: string; tool_use_id?: string })
              .toolCallId === callId
          ) {
            count += 1;
          }
        }
      }
    }
    if ((message as { role: string }).role === "toolResult") {
      if ((message as { toolCallId?: string }).toolCallId === callId)
        count += 1;
    }
  }
  return count;
}

/** Serialize the transformed messages and scan for the synthetic error stub
 *  pi-ai injects for orphaned tool calls ("No result provided"). */
function hasSyntheticNoResultStub(messages: Message[]): boolean {
  return JSON.stringify(messages).includes("No result provided");
}

// ── scripted model + streamFn (bypasses the real provider) ──────────────────

const FAKE_MODEL = {
  id: "spike-model",
  name: "Spike Model",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 4096,
} as unknown as Model<any>;

/** A streamFn that always completes with a fixed assistant text — proves the
 *  continuation reaches the model and produces a coherent follow-up. */
function scriptedStreamFn(finalText: string): StreamFn {
  return (() => {
    const stream = createAssistantMessageEventStream();
    const message = assistantText(finalText);
    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
    });
    return stream;
  }) as unknown as StreamFn;
}

function baseConfig(): AgentLoopConfig {
  return {
    model: FAKE_MODEL,
    convertToLlm: (messages: AgentMessage[]) =>
      convertToLlm(messages as never) as Message[],
    toolExecution: "sequential",
  } as unknown as AgentLoopConfig;
}

const NOOP_TOOL: AgentTool<any> = {
  name: "dagster_launch_run",
  label: "Launch run",
  description: "Launch a Dagster run",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ content: [{ type: "text", text: "unused" }] }),
} as unknown as AgentTool<any>;

// ── Scenario A: park → restart → inject → resume (no interleave) ─────────────

describe("U10 spike A — park, restart, inject result, resume in place", () => {
  it("persists the dangling tool_use across a JSONL restart at full fidelity", () => {
    const before: AgentMessage[] = [
      userMessage("launch the nightly pipeline") as AgentMessage,
      parkedAssistantMessage() as AgentMessage,
    ];
    const after = persistRestart(before);
    const assistant = after[1] as AssistantMessage;
    const toolCall = assistant.content.find(
      (part) => (part as { type: string }).type === "toolCall",
    ) as { id: string; name: string } | undefined;
    expect(toolCall?.id).toBe(CALL_ID);
    expect(toolCall?.name).toBe("dagster_launch_run");
    // Nothing closed it yet — it is genuinely parked.
    expect(toolResultBlockCount(after as Message[], CALL_ID)).toBe(0);
  });

  it("STRUCTURAL: convertToLlm preserves the dangling tool_use verbatim (orphan-closing is a deeper layer)", () => {
    // FINDING (disproved an initial hypothesis): the pi-agent-core harness
    // `convertToLlm` is a PURE STRUCTURAL MAP — it does NOT inject the
    // "No result provided" stub. That auto-close lives one layer down, in
    // pi-ai's provider `transform-messages` at the actual Bedrock send
    // boundary (bypassed here by the scripted streamFn). Consequence for
    // U12: the injected toolResult must live in the SESSION before the
    // provider send; you cannot rely on convertToLlm to notice the orphan.
    const parked: AgentMessage[] = [
      userMessage("launch it") as AgentMessage,
      parkedAssistantMessage() as AgentMessage,
    ];
    const llm = convertToLlm(parked as never) as Message[];
    expect(hasSyntheticNoResultStub(llm)).toBe(false);
    const assistant = llm[1] as AssistantMessage;
    const toolCall = assistant.content.find(
      (part) => (part as { type: string }).type === "toolCall",
    ) as { id: string } | undefined;
    expect(toolCall?.id).toBe(CALL_ID);
    expect(toolResultBlockCount(llm, CALL_ID)).toBe(0);
  });

  it("ENABLER: injecting the real toolResult closes the call with the real output", () => {
    const resumed: AgentMessage[] = persistRestart([
      userMessage("launch it") as AgentMessage,
      parkedAssistantMessage() as AgentMessage,
      approvedToolResult() as AgentMessage,
    ]);
    const llm = convertToLlm(resumed as never) as Message[];
    expect(hasSyntheticNoResultStub(llm)).toBe(false);
    expect(toolResultBlockCount(llm, CALL_ID)).toBe(1);
    expect(JSON.stringify(llm)).toContain("run_id=run_9f3a launched");
  });

  it("continues the SAME turn from the injected result (runAgentLoopContinue)", async () => {
    const resumed: AgentMessage[] = persistRestart([
      userMessage("launch it") as AgentMessage,
      parkedAssistantMessage() as AgentMessage,
      approvedToolResult() as AgentMessage,
    ]);
    const context: AgentContext = {
      systemPrompt: "spike",
      messages: resumed,
      tools: [NOOP_TOOL],
    };
    const emitted: string[] = [];
    const finalMessages = await runAgentLoopContinue(
      context,
      baseConfig(),
      (event) => {
        emitted.push(event.type);
      },
      undefined,
      scriptedStreamFn("Pipeline launched — run_9f3a is live."),
    );
    const last = finalMessages[finalMessages.length - 1] as AssistantMessage;
    const text = last.content.find(
      (part) => (part as { type: string }).type === "text",
    ) as { text: string } | undefined;
    expect(text?.text).toContain("run_9f3a");
    expect(emitted).toContain("agent_end");
  });

  it("GUARD: resuming with the dangling assistant as the last message is rejected", async () => {
    // Without appending the toolResult first, the last message is an
    // assistant message → agentLoopContinue refuses (would produce an
    // API-invalid request). This is the contract that forces "inject then
    // continue," never "continue then inject."
    const parked: AgentContext = {
      systemPrompt: "spike",
      messages: persistRestart([
        userMessage("launch it") as AgentMessage,
        parkedAssistantMessage() as AgentMessage,
      ]),
      tools: [NOOP_TOOL],
    };
    await expect(
      runAgentLoopContinue(
        parked,
        baseConfig(),
        () => {},
        undefined,
        scriptedStreamFn("unused"),
      ),
    ).rejects.toThrow(/assistant/i);
  });
});

// ── Scenario B: park → interleaved normal turn → restart → inject → resume ──

describe("U10 spike B — interleaved normal turn between park and resume", () => {
  /**
   * FINDING (disproved the "splice adjacently into the linear transcript"
   * hypothesis): `runAgentLoopContinue` reads the LAST message of the
   * context and rejects anything that isn't a user/toolResult. After an
   * interleaved normal turn, the linear transcript's tail is that turn's
   * assistant reply — so a linear continue over the whole transcript is
   * structurally impossible, no matter where the injected result sits.
   *
   * The resolution the spike settles for U12: resume runs on a BRANCH from
   * the PARKED LEAF. The resume context is exactly the parked turn plus the
   * injected result — the interleaved mainline turn is a sibling branch and
   * is NOT part of the resume context. SessionManager's branch/leaf control
   * (getLeafId at park time, branch() at resume) is the mechanism.
   */
  const parkedBranch: AgentMessage[] = [
    userMessage("launch the nightly pipeline") as AgentMessage,
    parkedAssistantMessage() as AgentMessage,
    approvedToolResult() as AgentMessage,
  ];
  const interleavedMainline: AgentMessage[] = [
    userMessage("launch the nightly pipeline") as AgentMessage,
    parkedAssistantMessage() as AgentMessage,
    userMessage("meanwhile, what's the weather?") as AgentMessage,
    assistantText("It is sunny.") as AgentMessage,
  ];

  it("a LINEAR continue over the interleaved transcript is rejected (tail is an assistant turn)", async () => {
    const context: AgentContext = {
      systemPrompt: "spike",
      messages: persistRestart(interleavedMainline),
      tools: [NOOP_TOOL],
    };
    await expect(
      runAgentLoopContinue(
        context,
        baseConfig(),
        () => {},
        undefined,
        scriptedStreamFn("unused"),
      ),
    ).rejects.toThrow(/assistant/i);
  });

  it("resumes coherently on a BRANCH from the parked leaf, independent of the interleaved turn", async () => {
    const context: AgentContext = {
      systemPrompt: "spike",
      // The resume branch: parked turn + injected result ONLY. The
      // interleaved mainline turn lives elsewhere in the session tree.
      messages: persistRestart(parkedBranch),
      tools: [NOOP_TOOL],
    };
    const emitted: string[] = [];
    const finalMessages = await runAgentLoopContinue(
      context,
      baseConfig(),
      (event) => {
        emitted.push(event.type);
      },
      undefined,
      scriptedStreamFn(
        "Pipeline run_9f3a is live — original request complete.",
      ),
    );
    const last = finalMessages[finalMessages.length - 1] as AssistantMessage;
    const text = last.content.find(
      (part) => (part as { type: string }).type === "text",
    ) as { text: string } | undefined;
    expect(text?.text).toContain("run_9f3a");
    expect(emitted).toContain("agent_end");
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────
 * VERDICT (feeds U12's approach) — recorded 2026-07-16
 * ─────────────────────────────────────────────────────────────────────────
 * OUTCOME A (call-site resume) — PROVEN FEASIBLE. The KTD-6 re-issue
 * FALLBACK is NOT needed; the Goal Capsule stop condition (spike disproves
 * call-site resume, forcing R12/R13 amendments) is NOT reached.
 *
 * PROVEN:
 * 1. The durable session (JSONL over S3, per durable-session-manager) round-
 *    trips an assistant message ending in an unfinished tool_use at full
 *    fidelity. Parking = "finalize the turn with the tool_use unclosed and
 *    persist"; no new machinery to represent a parked call.
 * 2. Resume = append the approved (or denial-shaped) `toolResult` into the
 *    session, then drive the pi-agent-core continuation entry
 *    `runAgentLoopContinue` — NOT `AgentSession.prompt()` (which adds a new
 *    user message). The runtime today only drives `prompt()`; exposing this
 *    continuation path is the ONE net-new piece of Pi machinery U12 builds.
 *    A scripted streamFn confirmed the continued turn reaches the model,
 *    references the injected result, and settles with `agent_end`.
 * 3. GUARD (structural, enforced by the library): `runAgentLoopContinue`
 *    rejects any context whose LAST message is an assistant message
 *    ("Cannot continue from message role: assistant"). So resume is strictly
 *    inject-then-continue, and the last message must be the toolResult.
 *
 * CORRECTED HYPOTHESES (the spike's real value):
 * 4. The pi-agent-core harness `convertToLlm` is a PURE STRUCTURAL MAP — it
 *    does NOT inject the "No result provided" orphan stub. That auto-close
 *    is a LOWER layer (pi-ai provider transform-messages, at the Bedrock
 *    send boundary). Implication: U12 cannot depend on convertToLlm to
 *    notice a missing result; the injected toolResult must already be in the
 *    session branch before the provider send. (Original "HAZARD" test
 *    reframed to "STRUCTURAL".)
 * 5. INTERLEAVING RULE — resume runs on a BRANCH from the parked leaf, NOT a
 *    linear continue over the whole transcript. After an interleaved normal
 *    turn, the linear transcript tail is that turn's assistant reply, so
 *    `runAgentLoopContinue` over the full transcript is structurally
 *    rejected by the guard in (3) — no amount of splicing the result earlier
 *    fixes the tail. Concretely: capture the parked leaf id at park time;
 *    at resume, branch from that leaf, append the toolResult on the branch
 *    (making it the branch tail), and continue there. The interleaved turn
 *    is a sibling branch. Per-thread ETag optimistic concurrency
 *    (SessionConflictError) already guards a racing interleaved writer.
 *
 * NET FOR U12: implement call-site resume exactly as R12 (execute at the
 * paused call) and R13 (deny returns a denial toolResult; turn continues).
 * Add to U12's scope: (a) a runtime continuation entry wrapping
 * runAgentLoopContinue; (b) branch-from-parked-leaf resume using
 * SessionManager leaf/branch control; (c) inject-then-continue ordering.
 * No R12/R13 rewrite; the fallback stays unbuilt.
 */
