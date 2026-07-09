import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import {
  deleteAutomation,
  saveAutomation,
  validateAutomationSchedule,
} from "./automations.js";

function mockGraphql(data: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const SAVED = {
  saveAgentLoop: {
    id: "loop-1",
    name: "Daily GWO Report",
    slug: "daily-gwo-report",
    lifecycleStatus: "active",
    enabled: true,
  },
};

function baseInput() {
  return {
    tenantId: "tenant-1",
    name: "Daily GWO Report",
    instructions: "Refresh the GWO pipeline report from the CRM.",
    scheduleExpression: "cron(0 9 * * ? *)",
    timezone: "America/Chicago",
    spaceId: "space-1",
    documentBinding: { mode: "existing" as const, artifactId: "art-9" },
    deliveryRecipients: ["bodom@texasenterprises.com"],
  };
}

describe("validateAutomationSchedule (R14)", () => {
  it("accepts cron + IANA timezone", () => {
    expect(
      validateAutomationSchedule({
        scheduleExpression: "cron(0 9 * * ? *)",
        timezone: "America/Chicago",
      }),
    ).toBeNull();
  });

  it("rejects rate() — EventBridge ignores timezones on rate schedules", () => {
    const error = validateAutomationSchedule({
      scheduleExpression: "rate(1 day)",
      timezone: "America/Chicago",
    });
    expect(error).toMatch(/must be a cron\(\) expression/);
    expect(error).toMatch(/cron\(0 9 \* \* \? \*\)/); // names the fix
  });

  it("rejects a missing timezone", () => {
    expect(
      validateAutomationSchedule({
        scheduleExpression: "cron(0 9 * * ? *)",
        timezone: " ",
      }),
    ).toMatch(/timezone is required/);
  });
});

describe("saveAutomation", () => {
  it("POSTs saveAgentLoop with the server-threaded identity headers and the full spec", async () => {
    const fetchImpl = mockGraphql(SAVED);
    const client = createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      principalId: "member-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      fetchImpl,
    });

    const saved = await saveAutomation(client, baseInput());
    expect(saved.id).toBe("loop-1");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/graphql");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["x-principal-id"]).toBe("member-1");
    expect(headers["x-agent-id"]).toBe("agent-1");
    expect(headers["x-tenant-id"]).toBe("tenant-1");

    const body = JSON.parse((init as { body: string }).body) as {
      query: string;
      variables: { input: Record<string, unknown> };
    };
    expect(body.query).toContain("saveAgentLoop");
    const input = body.variables.input;
    expect(input).toMatchObject({
      tenantId: "tenant-1",
      name: "Daily GWO Report",
      spaceId: "space-1",
      triggerSpec: {
        family: "schedule",
        source: "admin_ops_mcp",
        config: {
          scheduleType: "cron",
          scheduleExpression: "cron(0 9 * * ? *)",
          timezone: "America/Chicago",
        },
      },
      targetSpec: {
        kind: "agent_thread",
        agentThread: {
          instructions: "Refresh the GWO pipeline report from the CRM.",
          threadMode: "new_per_run",
        },
        documentBinding: { mode: "existing", artifactId: "art-9" },
        delivery: { recipients: ["bodom@texasenterprises.com"] },
      },
      // Prompt-first metadata triggers the server's default-worker inference.
      sourceMetadata: {
        createdFrom: "admin_ops_mcp",
        creationMode: "easy",
        prompt: "Refresh the GWO pipeline report from the CRM.",
      },
    });
    expect(input.id).toBeUndefined(); // create, not update
  });

  it("carries the automationId as input.id on update", async () => {
    const fetchImpl = mockGraphql(SAVED);
    const client = createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      principalId: "member-1",
      tenantId: "tenant-1",
      fetchImpl,
    });
    await saveAutomation(client, {
      ...baseInput(),
      automationId: "loop-1",
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as { body: string }).body,
    ) as { variables: { input: { id?: string } } };
    expect(body.variables.input.id).toBe("loop-1");
  });

  it("rejects rate() schedules before any network call", async () => {
    const fetchImpl = mockGraphql(SAVED);
    const client = createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      fetchImpl,
    });
    await expect(
      saveAutomation(client, {
        ...baseInput(),
        scheduleExpression: "rate(1 day)",
      }),
    ).rejects.toThrow(/must be a cron\(\) expression/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects delivery without a binding before any network call, with binding guidance", async () => {
    const fetchImpl = mockGraphql(SAVED);
    const client = createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      fetchImpl,
    });
    await expect(
      saveAutomation(client, {
        ...baseInput(),
        documentBinding: undefined,
      }),
    ).rejects.toThrow(/deliveryRecipients requires documentBinding/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces GraphQL errors (e.g. the U11 refusal) verbatim", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [
            {
              message:
                "Members can only email scheduled reports to themselves — adding other recipients needs an operator.",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      fetchImpl,
    });
    await expect(saveAutomation(client, baseInput())).rejects.toThrow(
      /only email scheduled reports to themselves/,
    );
  });
});

describe("deleteAutomation", () => {
  it("POSTs deleteAgentLoop with the automation id", async () => {
    const fetchImpl = mockGraphql({
      deleteAgentLoop: { id: "loop-1", ok: true },
    });
    const client = createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      principalId: "member-1",
      tenantId: "tenant-1",
      fetchImpl,
    });
    const out = await deleteAutomation(client, { automationId: "loop-1" });
    expect(out).toEqual({ id: "loop-1", ok: true });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0][1] as { body: string }).body,
    ) as { query: string; variables: { id: string } };
    expect(body.query).toContain("deleteAgentLoop");
    expect(body.variables.id).toBe("loop-1");
  });
});
