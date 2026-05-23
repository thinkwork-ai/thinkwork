import { describe, expect, it, vi } from "vitest";
import {
  renderWorkspaceTupleForInvoke,
  resolveChatInvokeIdentity,
  resolveChatInvocationRuntimeType,
  type ChatInvokeIdentityDeps,
} from "./chat-agent-invoke.js";

function deps(
  overrides: Partial<ChatInvokeIdentityDeps> = {},
): ChatInvokeIdentityDeps {
  return {
    loadMessageSender: vi.fn(async () => null),
    loadThreadCreator: vi.fn(async () => null),
    loadAgentHumanPair: vi.fn(async () => null),
    loadUserEmail: vi.fn(async (userId) => `${userId}@example.com`),
    ...overrides,
  };
}

const baseArgs = {
  threadId: "thread-1",
  tenantId: "tenant-1",
  agentId: "agent-1",
};

describe("resolveChatInvokeIdentity", () => {
  it("uses the human message sender when present", async () => {
    const subject = deps({
      loadMessageSender: vi.fn(async () => ({
        sender_id: "user-message",
        sender_type: "human",
      })),
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "user-thread",
        created_by_type: "user",
      })),
    });

    const identity = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: "message-1" },
      subject,
    );

    expect(identity).toEqual({
      currentUserId: "user-message",
      currentUserEmail: "user-message@example.com",
      source: "message_sender",
    });
    expect(subject.loadThreadCreator).not.toHaveBeenCalled();
  });

  it("falls back to the user-created thread when the message is not human-authored", async () => {
    const subject = deps({
      loadMessageSender: vi.fn(async () => ({
        sender_id: "system-1",
        sender_type: "system",
      })),
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "user-thread",
        created_by_type: "user",
      })),
    });

    const identity = await resolveChatInvokeIdentity(
      { ...baseArgs, messageId: "message-1" },
      subject,
    );

    expect(identity).toEqual({
      currentUserId: "user-thread",
      currentUserEmail: "user-thread@example.com",
      source: "thread_creator",
    });
  });

  it("uses the delegated agent's paired human for Computer-owned threads", async () => {
    const subject = deps({
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: "computer-1",
        created_by_type: "computer",
      })),
      loadAgentHumanPair: vi.fn(async () => "paired-human"),
    });

    const identity = await resolveChatInvokeIdentity(baseArgs, subject);

    expect(identity).toEqual({
      currentUserId: "paired-human",
      currentUserEmail: "paired-human@example.com",
      source: "computer_agent_human_pair",
    });
    expect(subject.loadAgentHumanPair).toHaveBeenCalledWith({
      agentId: "agent-1",
      tenantId: "tenant-1",
    });
  });

  it("does not use the agent human pair for generic non-computer threads", async () => {
    const subject = deps({
      loadThreadCreator: vi.fn(async () => ({
        created_by_id: null,
        created_by_type: "system",
      })),
      loadAgentHumanPair: vi.fn(async () => "paired-human"),
    });

    const identity = await resolveChatInvokeIdentity(baseArgs, subject);

    expect(identity).toEqual({
      currentUserId: "",
      currentUserEmail: "",
      source: "none",
    });
    expect(subject.loadAgentHumanPair).not.toHaveBeenCalled();
  });
});

describe("resolveChatInvocationRuntimeType", () => {
  it("uses the configured Pi runtime for normal agent turns", () => {
    expect(
      resolveChatInvocationRuntimeType({
        configuredRuntimeType: "pi",
      }),
    ).toBe("pi");
  });

  it("uses the configured Pi runtime for Computer-backed turns", () => {
    expect(
      resolveChatInvocationRuntimeType({
        configuredRuntimeType: "pi",
        computerId: "computer-1",
        computerTaskId: "task-1",
      }),
    ).toBe("pi");
  });

  it("keeps using the configured runtime when only one Computer identifier is present", () => {
    expect(
      resolveChatInvocationRuntimeType({
        configuredRuntimeType: "pi",
        computerId: "computer-1",
      }),
    ).toBe("pi");
  });
});

describe("renderWorkspaceTupleForInvoke", () => {
  it("invokes the workspace-renderer Lambda and returns the rendered prefix", async () => {
    const send = vi.fn(
      async (_command: { input: Record<string, unknown> }) => ({
        Payload: new TextEncoder().encode(
          JSON.stringify({
            ok: true,
            renderedPrefix: "tenants/acme/rendered/marco/default/eric/",
            cacheStatus: "hit",
            activeSpace: {
              id: "space-1",
              slug: "default",
              name: "Default",
              isDefault: true,
            },
            effectivePolicy: {
              blockedTools: ["send_email"],
              allowedTools: null,
              mcpAllowedServers: null,
              mcpBlockedServers: [],
              diagnostics: [],
            },
          }),
        ),
      }),
    );

    await expect(
      renderWorkspaceTupleForInvoke(
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          spaceId: "space-1",
          userId: "user-1",
          agentBlockedTools: ["browser_automation"],
        },
        { functionName: "renderer", lambda: { send } as any },
      ),
    ).resolves.toEqual({
      rendered: true,
      renderedPrefix: "tenants/acme/rendered/marco/default/eric/",
      cacheStatus: "hit",
      activeSpace: {
        id: "space-1",
        slug: "default",
        name: "Default",
        isDefault: true,
      },
      effectivePolicy: {
        blockedTools: ["send_email"],
        allowedTools: null,
        mcpAllowedServers: null,
        mcpBlockedServers: [],
        diagnostics: [],
      },
    });
    const command = send.mock.calls.at(0)?.[0] as
      | { input: Record<string, unknown> }
      | undefined;
    expect(command?.input).toMatchObject({
      FunctionName: "renderer",
      InvocationType: "RequestResponse",
    });
    const payload =
      command?.input.Payload instanceof Uint8Array
        ? new TextDecoder().decode(command.input.Payload)
        : "{}";
    expect(JSON.parse(payload)).toMatchObject({
      agentBlockedTools: ["browser_automation"],
    });
  });

  it("falls back when the renderer function is not configured", async () => {
    await expect(
      renderWorkspaceTupleForInvoke(
        {
          tenantId: "tenant-1",
          agentId: "agent-1",
          spaceId: "space-1",
        },
        { functionName: "" },
      ),
    ).resolves.toEqual({
      rendered: false,
      reason: "workspace_renderer_unconfigured",
    });
  });
});
