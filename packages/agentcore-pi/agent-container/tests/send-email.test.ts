import { describe, expect, it, vi } from "vitest";

import { buildSendEmailTool } from "../src/runtime/tools/send-email.js";

describe("buildSendEmailTool", () => {
  it("posts active Space email sends to the platform endpoint", async () => {
    const fetchCalls: Array<[string | URL | Request, RequestInit | undefined]> =
      [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push([input, init]);
        return new Response(
          JSON.stringify({ messageId: "ses-123", status: "sent" }),
          { status: 200 },
        );
      },
    );
    const tool = buildSendEmailTool({
      sendEmailConfig: {
        apiUrl: "https://api.example.com/",
        apiSecret: "secret",
        agentId: "agent-1",
        tenantId: "tenant-1",
        threadId: "thread-1",
      },
      payload: {
        tenant_slug: "acme",
        turn_context: { spaceSlug: "finance" },
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(tool?.name).toBe("send_email");
    const result = await tool?.execute("call-1", {
      to: ["eric@example.com"],
      subject: "Recent CRM Opportunities",
      body: "Here are the results.",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchCalls[0]?.[0]).toBe("https://api.example.com/api/email/send");
    expect(fetchCalls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "x-tenant-id": "tenant-1",
        "x-agent-id": "agent-1",
      },
    });
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toEqual({
      agentId: "agent-1",
      to: "eric@example.com",
      subject: "Recent CRM Opportunities",
      body: "Here are the results.",
      threadId: "thread-1",
      spaceTenantSlug: "acme",
      spaceSlug: "finance",
    });
    expect(result).toMatchObject({
      details: {
        ok: true,
        runtime: "pi",
        messageId: "ses-123",
        status: "sent",
      },
    });
  });

  it("resolves me and placeholder recipients to the current requester email", async () => {
    const fetchCalls: Array<[string | URL | Request, RequestInit | undefined]> =
      [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push([input, init]);
        return new Response(
          JSON.stringify({ messageId: "ses-123", status: "sent" }),
          { status: 200 },
        );
      },
    );
    const tool = buildSendEmailTool({
      sendEmailConfig: {
        apiUrl: "https://api.example.com",
        apiSecret: "secret",
        agentId: "agent-1",
        tenantId: "tenant-1",
      },
      payload: {
        tenant_slug: "acme",
        current_user_email: "eric@thinkwork.ai",
        turn_context: { spaceSlug: "finance" },
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await tool?.execute("call-1", {
      to: ["me", "user@example.com"],
      subject: "Thread status",
      body: "Here is the status.",
    });

    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toMatchObject({
      to: "eric@thinkwork.ai",
    });
  });

  it("rejects me when the current requester email is unavailable", async () => {
    const fetchImpl = vi.fn();
    const tool = buildSendEmailTool({
      sendEmailConfig: {
        apiUrl: "https://api.example.com",
        apiSecret: "secret",
        agentId: "agent-1",
        tenantId: "tenant-1",
      },
      payload: { tenant_slug: "acme", turn_context: { spaceSlug: "finance" } },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      tool?.execute("call-1", {
        to: "me",
        subject: "Thread status",
        body: "Here is the status.",
      }),
    ).rejects.toThrow(/current user email is unavailable/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when runtime credentials are incomplete", () => {
    const tool = buildSendEmailTool({
      sendEmailConfig: {
        apiUrl: "https://api.example.com",
        apiSecret: "",
        agentId: "agent-1",
        tenantId: "tenant-1",
      },
      payload: { tenant_slug: "acme", turn_context: { spaceSlug: "finance" } },
    });

    expect(tool).toBeNull();
  });

  it("fails before posting when active Space context is missing", async () => {
    const fetchImpl = vi.fn();
    const tool = buildSendEmailTool({
      sendEmailConfig: {
        apiUrl: "https://api.example.com",
        apiSecret: "secret",
        agentId: "agent-1",
        tenantId: "tenant-1",
      },
      payload: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      tool?.execute("call-1", {
        to: "eric@example.com",
        subject: "Recent CRM Opportunities",
        body: "Here are the results.",
      }),
    ).rejects.toThrow(/active Space email context/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
