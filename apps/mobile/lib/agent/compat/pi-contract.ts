import type { AgentEvent, Message } from "../types";

export type PiCompatibilityStatus = "implemented" | "deferred" | "out_of_scope";

export interface PiCompatibilityFeature {
  id: string;
  status: PiCompatibilityStatus;
  upstreamSurface: string;
  mobileSurface: string;
  ownerUnit?: string;
  notes: string;
}

export interface MobilePiCompatibilityContract {
  version: string;
  host: "thinkwork-mobile-hermes";
  upstreamSdkEmbedding: {
    status: "out_of_scope";
    evidence: string;
    revisitWhen: string[];
  };
  publicSurface: {
    session: readonly string[];
    modelProvider: readonly string[];
    tool: readonly string[];
    extensionApi: readonly string[];
    extensionEvents: readonly string[];
  };
  goldenSequences: {
    toolTurnEventTypes: readonly AgentEvent["type"][];
    toolTurnRoles: readonly Message["role"][];
  };
  features: readonly PiCompatibilityFeature[];
}

export const MOBILE_PI_COMPATIBILITY_CONTRACT: MobilePiCompatibilityContract = {
  version: "2026-05-30.u3",
  host: "thinkwork-mobile-hermes",
  upstreamSdkEmbedding: {
    status: "out_of_scope",
    evidence:
      "docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md",
    revisitWhen: [
      "A maintained Node >=22.19 iOS embedder exists.",
      "The upstream Pi SDK load path no longer requires native Node addons.",
    ],
  },
  publicSurface: {
    session: [
      "createAgentSession",
      "messages",
      "tools",
      "systemPrompt",
      "prompt",
      "ready",
      "subscribe",
      "abort",
    ],
    modelProvider: ["id", "generate"],
    tool: ["name", "description", "parameters", "execute"],
    extensionApi: ["registerTool", "on", "logger"],
    extensionEvents: [
      "before_agent_start",
      "agent_start",
      "tool_call",
      "after_tool_call",
      "agent_end",
    ],
  },
  goldenSequences: {
    toolTurnEventTypes: [
      "assistant_text",
      "tool_call",
      "tool_result",
      "assistant_text",
      "done",
    ],
    toolTurnRoles: ["user", "assistant", "tool", "assistant"],
  },
  features: [
    {
      id: "stateful-session-surface",
      status: "implemented",
      upstreamSurface: "createAgentSession() session facade",
      mobileSurface: "apps/mobile/lib/agent/session.ts",
      notes:
        "Mobile exposes a synchronous createAgentSession facade with messages, tools, prompt, ready, subscribe, and abort.",
    },
    {
      id: "flat-tool-definition",
      status: "implemented",
      upstreamSurface: "defineTool() / AgentTool shape",
      mobileSurface: "apps/mobile/lib/agent/types.ts",
      notes:
        "Mobile tools are flat model-facing definitions with an execute handler.",
    },
    {
      id: "model-provider-seam",
      status: "implemented",
      upstreamSurface: "provider-backed model generation",
      mobileSurface: "apps/mobile/lib/agent/types.ts",
      notes:
        "The loop depends on ModelProvider.generate rather than a concrete Bedrock client.",
    },
    {
      id: "extension-tool-registration",
      status: "implemented",
      upstreamSurface: "ExtensionAPI.registerTool",
      mobileSurface: "apps/mobile/lib/agent/extensions/load-extensions.ts",
      notes:
        "Mobile extensions register additive tools before the first prompt.",
    },
    {
      id: "before-agent-start-prompt-composition",
      status: "implemented",
      upstreamSurface: "before_agent_start",
      mobileSurface: "apps/mobile/lib/agent/extensions/load-extensions.ts",
      notes:
        "Mobile chains before_agent_start handlers to compose the system prompt.",
    },
    {
      id: "observable-tool-turn-events",
      status: "implemented",
      upstreamSurface: "session event stream",
      mobileSurface: "apps/mobile/lib/agent/loop.ts",
      notes:
        "Mobile emits assistant_text, tool_call, tool_result, done, and error events through subscribe/onEvent.",
    },
    {
      id: "pre-model-abort",
      status: "implemented",
      upstreamSurface: "abort signal before model call",
      mobileSurface: "apps/mobile/lib/agent/loop.ts",
      notes:
        "A turn whose AbortSignal is already aborted exits with stopReason aborted before calling the provider.",
    },
    {
      id: "shared-thinkwork-extension-adapter",
      status: "implemented",
      upstreamSurface: "Pi extension factories plus provider bundle",
      mobileSurface:
        "apps/mobile/lib/agent/extensions/thinkwork-extension-adapter.ts",
      notes:
        "Mobile can adapt structurally compatible ThinkWork extensions without runtime-importing the upstream Pi SDK.",
    },
    {
      id: "shared-system-prompt-composition",
      status: "implemented",
      upstreamSurface: "thinkwork-system-prompt extension",
      mobileSurface:
        "apps/mobile/lib/agent/extensions/workspace-context-extension.ts",
      notes:
        "Mobile composes the shared ThinkWork prompt order through packages/pi-extensions/src/system-prompt-compose.ts over its workspace file reader.",
    },
    {
      id: "workspace-backed-built-ins",
      status: "deferred",
      upstreamSurface: "cwd-backed read/grep/find/ls/edit/write/bash",
      mobileSurface: "apps/mobile/lib/agent/workspace-cache.ts",
      ownerUnit: "U4",
      notes:
        "Mobile local bash exists, but read/grep/find/ls over a rendered workspace cache land in U4.",
    },
    {
      id: "workspace-backed-bash-durability",
      status: "deferred",
      upstreamSurface: "cwd-backed bash",
      mobileSurface: "apps/mobile/lib/agent/extensions/local-bash-extension.ts",
      ownerUnit: "U5",
      notes:
        "Mobile bash is currently just-bash backed and thread-keyed in process; durable workspace mounting lands in U5.",
    },
    {
      id: "bounded-mcp-proxy-tool",
      status: "deferred",
      upstreamSurface: "pi-mcp-adapter proxy tool",
      mobileSurface: "apps/mobile/lib/agent/extensions/mcp-tools-extension.ts",
      ownerUnit: "U6",
      notes:
        "Mobile still exposes tenant MCP tools directly; the default bounded mcp tool lands in U6.",
    },
    {
      id: "extension-lifecycle-loop-dispatch",
      status: "deferred",
      upstreamSurface: "agent/tool lifecycle extension events",
      mobileSurface: "apps/mobile/lib/agent/loop.ts",
      ownerUnit: "U7",
      notes:
        "The mobile event bus can dispatch lifecycle events, but the loop only wires before_agent_start today.",
    },
    {
      id: "in-flight-abort-follow-up-steer",
      status: "deferred",
      upstreamSurface: "abort, steer, followUp",
      mobileSurface: "apps/mobile/lib/agent/session.ts",
      ownerUnit: "U7",
      notes:
        "Mobile exposes abort but does not yet provide full Pi-style in-flight steering or follow-up queues.",
    },
    {
      id: "durable-session-compaction",
      status: "deferred",
      upstreamSurface: "SessionManager files and compaction entries",
      mobileSurface: "apps/mobile/lib/agent/session-store.ts",
      ownerUnit: "U7",
      notes:
        "Mobile persists flattened thread turns today; structured durable session transcript and compaction land in U7.",
    },
    {
      id: "upstream-sdk-on-ios",
      status: "out_of_scope",
      upstreamSurface: "@earendil-works/pi-coding-agent runtime",
      mobileSurface: "not applicable",
      notes:
        "Running the upstream Node SDK on iOS is blocked by Node >=22.19 and native-addon constraints.",
    },
  ],
};

export function piCompatibilityFeature(
  id: string,
): PiCompatibilityFeature | undefined {
  return MOBILE_PI_COMPATIBILITY_CONTRACT.features.find(
    (feature) => feature.id === id,
  );
}

export function piCompatibilityStatus(
  id: string,
): PiCompatibilityStatus | undefined {
  return piCompatibilityFeature(id)?.status;
}

export function implementedPiCompatibilityFeatureIds(): string[] {
  return MOBILE_PI_COMPATIBILITY_CONTRACT.features
    .filter((feature) => feature.status === "implemented")
    .map((feature) => feature.id);
}

export function deferredPiCompatibilityFeatureIds(): string[] {
  return MOBILE_PI_COMPATIBILITY_CONTRACT.features
    .filter((feature) => feature.status === "deferred")
    .map((feature) => feature.id);
}

export function eventTypes(
  events: readonly AgentEvent[],
): AgentEvent["type"][] {
  return events.map((event) => event.type);
}

export function transcriptRoles(
  messages: readonly Message[],
): Message["role"][] {
  return messages.map((message) => message.role);
}
