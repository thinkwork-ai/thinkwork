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
  version: "2026-05-30.u8",
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
      "followUp",
      "steer",
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
      "agent_start",
      "assistant_text",
      "tool_call",
      "tool_result",
      "after_tool_call",
      "assistant_text",
      "agent_end",
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
        "Mobile emits agent_start, assistant_text, tool_call, tool_result, after_tool_call, agent_end, done, and error events through subscribe/onEvent.",
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
      status: "implemented",
      upstreamSurface: "cwd-backed read/grep/find/ls/edit/write/bash",
      mobileSurface: "apps/mobile/lib/agent/workspace-cache.ts",
      notes:
        "Mobile maintains a durable rendered workspace cache and exposes read, grep, find, and ls tools over that cache.",
    },
    {
      id: "task-status-tool",
      status: "implemented",
      upstreamSurface:
        "set_work_item_status native platform extension plus set_task_status compatibility extension",
      mobileSurface:
        "apps/mobile/lib/agent/extensions/task-status-extension.ts",
      ownerUnit: "THNK-69 U4",
      notes:
        "Mobile exposes set_work_item_status for native Work Items and preserves set_task_status for linked_tasks compatibility; both write through the API/database rather than editing GOAL.md or PROGRESS.md.",
    },
    {
      id: "bounded-mcp-proxy-tool",
      status: "implemented",
      upstreamSurface: "pi-mcp-adapter proxy tool",
      mobileSurface: "apps/mobile/lib/agent/extensions/mcp-tools-extension.ts",
      notes:
        "Mobile exposes one default `mcp` gateway for list/search/call over tenant MCP tools; direct per-tool registration is opt-in by allowlist.",
    },
    {
      id: "fetch-workspace-source-tool",
      status: "deferred",
      upstreamSurface: "fetch_workspace_source platform extension",
      mobileSurface: "apps/mobile/lib/agent/workspace-cache.ts",
      ownerUnit: "2026-06-12-002 U5",
      notes:
        "TODO: cloud-only for now. The U4 fetch-source endpoint authenticates with the platform bearer secret and returns raw S3 keys the runtime downloads itself; the mobile host signs in with per-user Cognito tokens (the platform secret must never ship on-device) and holds no S3 credentials, so it needs a Cognito-authed platform facade that streams file content (the platform-tools-client pattern) before it can mount fetched folders read-only into the workspace cache partition and append the local diff baseline.",
    },
    {
      id: "extension-lifecycle-loop-dispatch",
      status: "implemented",
      upstreamSurface: "agent/tool lifecycle extension events",
      mobileSurface: "apps/mobile/lib/agent/loop.ts",
      ownerUnit: "U7",
      notes:
        "The mobile session bridges loop events into extension handlers for agent_start, tool_call, after_tool_call, and agent_end.",
    },
    {
      id: "in-flight-abort-follow-up-steer",
      status: "implemented",
      upstreamSurface: "abort, steer, followUp",
      mobileSurface: "apps/mobile/lib/agent/session.ts",
      ownerUnit: "U7",
      notes:
        "Mobile aborts the active turn and serializes prompt/followUp/steer calls through one transcript queue; steer is a queued follow-up until the UI grows a separate live steering affordance.",
    },
    {
      id: "durable-session-compaction",
      status: "implemented",
      upstreamSurface: "SessionManager files and compaction entries",
      mobileSurface: "apps/mobile/lib/agent/session-store.ts",
      ownerUnit: "U7",
      notes:
        "Mobile records structured session events/transcripts in turn evidence and has deterministic session-store compaction helpers for long transcripts.",
    },
    {
      id: "mobile-native-host-extensions",
      status: "implemented",
      upstreamSurface: "host-provided tools/extensions",
      mobileSurface: "apps/mobile/lib/agent/extensions/mobile-native",
      ownerUnit: "U8",
      notes:
        "Mobile models photo, file, and clipboard powers as explicit host extensions with visible permission/picker affordances and structured capability evidence.",
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
