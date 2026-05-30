import { describe, expect, it } from "vitest";
import { defineExtension } from "../extensions/define-extension";
import { runAgentTurn } from "../loop";
import {
  MockModelProvider,
  textResponse,
  toolResponse,
} from "../providers/mock";
import { createAgentSession, defineTool } from "../session";
import type { AgentEvent, Tool } from "../types";
import {
  MOBILE_PI_COMPATIBILITY_CONTRACT,
  deferredPiCompatibilityFeatureIds,
  eventTypes,
  implementedPiCompatibilityFeatureIds,
  piCompatibilityStatus,
  transcriptRoles,
} from "./pi-contract";

function echoTool(): Tool {
  return defineTool({
    name: "echo",
    description: "Echo the input",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    execute: async (args) => ({ content: `echo:${String(args.value)}` }),
  });
}

describe("MOBILE_PI_COMPATIBILITY_CONTRACT", () => {
  it("records the mobile host surface and the upstream iOS SDK boundary", () => {
    expect(MOBILE_PI_COMPATIBILITY_CONTRACT.host).toBe(
      "thinkwork-mobile-hermes",
    );
    expect(MOBILE_PI_COMPATIBILITY_CONTRACT.publicSurface.session).toEqual([
      "createAgentSession",
      "messages",
      "tools",
      "systemPrompt",
      "prompt",
      "ready",
      "subscribe",
      "abort",
    ]);
    expect(MOBILE_PI_COMPATIBILITY_CONTRACT.publicSurface.extensionApi).toEqual(
      ["registerTool", "on", "logger"],
    );
    expect(MOBILE_PI_COMPATIBILITY_CONTRACT.upstreamSdkEmbedding).toMatchObject(
      {
        status: "out_of_scope",
        evidence:
          "docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md",
      },
    );
  });

  it("makes implemented and deferred compatibility explicit", () => {
    expect(implementedPiCompatibilityFeatureIds()).toEqual(
      expect.arrayContaining([
        "stateful-session-surface",
        "flat-tool-definition",
        "model-provider-seam",
        "extension-tool-registration",
        "before-agent-start-prompt-composition",
        "observable-tool-turn-events",
        "pre-model-abort",
        "shared-thinkwork-extension-adapter",
        "shared-system-prompt-composition",
        "workspace-backed-built-ins",
        "workspace-backed-bash-durability",
        "bounded-mcp-proxy-tool",
      ]),
    );
    expect(deferredPiCompatibilityFeatureIds()).toEqual(
      expect.arrayContaining([
        "extension-lifecycle-loop-dispatch",
        "durable-session-compaction",
      ]),
    );
    expect(piCompatibilityStatus("upstream-sdk-on-ios")).toBe("out_of_scope");
  });
});

describe("mobile Pi contract golden behavior", () => {
  it("loads extensions before the first prompt and appends their tools", async () => {
    const provider = new MockModelProvider([textResponse("ready")]);
    const connectedTool = defineTool({
      name: "connected_tool",
      description: "Connected tool",
      parameters: { type: "object" },
      execute: async () => ({ content: "connected" }),
    });
    const ext = defineExtension({
      name: "contract-extension",
      register(pi) {
        pi.registerTool(connectedTool);
        pi.on("before_agent_start", (event) => ({
          systemPrompt: `${event.systemPrompt}\n\nExtension context loaded.`,
        }));
      },
    });
    const session = createAgentSession({
      modelProvider: provider,
      systemPrompt: "Base identity.",
      tools: [echoTool()],
      extensions: [ext],
    });

    await session.ready();

    expect(session.tools.map((tool) => tool.name)).toEqual([
      "echo",
      "connected_tool",
    ]);
    expect(session.systemPrompt).toBe(
      "Base identity.\n\nExtension context loaded.",
    );

    await session.prompt("go");
    expect(provider.requests[0].tools.map((tool) => tool.name)).toEqual([
      "echo",
      "connected_tool",
    ]);
    expect(provider.requests[0].system).toBe(
      "Base identity.\n\nExtension context loaded.",
    );
  });

  it("chains before_agent_start prompt hooks in extension registration order", async () => {
    const provider = new MockModelProvider([textResponse("ok")]);
    const first = defineExtension({
      name: "first",
      register(pi) {
        pi.on("before_agent_start", (event) => ({
          systemPrompt: `${event.systemPrompt}\nfirst`,
        }));
      },
    });
    const second = defineExtension({
      name: "second",
      register(pi) {
        pi.on("before_agent_start", (event) => ({
          systemPrompt: `${event.systemPrompt}\nsecond`,
        }));
      },
    });
    const session = createAgentSession({
      modelProvider: provider,
      systemPrompt: "base",
      extensions: [first, second],
    });

    await session.prompt("go");

    expect(provider.requests[0].system).toBe("base\nfirst\nsecond");
  });

  it("emits the golden event order and transcript shape for a tool turn", async () => {
    const provider = new MockModelProvider([
      toolResponse("call-1", "echo", { value: "ping" }, "checking"),
      textResponse("done"),
    ]);
    const events: AgentEvent[] = [];
    const session = createAgentSession({
      modelProvider: provider,
      tools: [echoTool()],
    });

    session.subscribe((event) => events.push(event));
    const result = await session.prompt("echo ping");

    expect(result.finalText).toBe("done");
    expect(eventTypes(events)).toEqual(
      MOBILE_PI_COMPATIBILITY_CONTRACT.goldenSequences.toolTurnEventTypes,
    );
    expect(transcriptRoles(result.messages)).toEqual(
      MOBILE_PI_COMPATIBILITY_CONTRACT.goldenSequences.toolTurnRoles,
    );
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      content: "checking",
      toolCalls: [{ id: "call-1", name: "echo", arguments: { value: "ping" } }],
    });
    expect(result.messages[2]).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      name: "echo",
      content: "echo:ping",
    });
  });

  it("returns aborted before the provider is called when the signal is already aborted", async () => {
    const provider = new MockModelProvider([textResponse("should not run")]);
    const events: AgentEvent[] = [];

    const result = await runAgentTurn({
      provider,
      tools: [],
      messages: [{ role: "user", content: "stop" }],
      signal: AbortSignal.abort(),
      onEvent: (event) => events.push(event),
    });

    expect(result.stopReason).toBe("aborted");
    expect(result.steps).toBe(0);
    expect(provider.requests).toEqual([]);
    expect(eventTypes(events)).toEqual(["done"]);
  });
});
