import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import {
  deleteAutomation,
  saveAutomation,
  validateAutomationSchedule,
} from "./automations.js";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const SPACES = {
  spaces: [{ id: "space-1", name: "General", slug: "general" }],
};

/** saveAutomation now resolves the Space first — queue the spaces response
 * ahead of the mutation response(s). */
function mockGraphql(data: unknown): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ data: SPACES }))
    .mockResolvedValue(jsonResponse({ data }));
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

    const [url, init] = fetchImpl.mock.calls[1];
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
      (fetchImpl.mock.calls[1][1] as { body: string }).body,
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
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: SPACES }))
      .mockResolvedValue(
        jsonResponse({
          errors: [
            {
              message:
                "Members can only email scheduled reports to themselves — adding other recipients needs an operator.",
            },
          ],
        }),
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

describe("saveAutomation space resolution (THINK-246)", () => {
  function clientWith(fetchImpl: ReturnType<typeof vi.fn>) {
    return createClient({
      apiUrl: "https://api.example.com",
      authSecret: "s3cret",
      principalId: "member-1",
      tenantId: "tenant-1",
      fetchImpl,
    });
  }

  it("resolves a Space slug to its UUID before the mutation", async () => {
    const fetchImpl = mockGraphql(SAVED);
    await saveAutomation(clientWith(fetchImpl), {
      ...baseInput(),
      spaceId: "general",
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[1][1] as { body: string }).body,
    ) as { variables: { input: { spaceId: string } } };
    expect(body.variables.input.spaceId).toBe("space-1");
  });

  it("resolves a Space name case-insensitively", async () => {
    const fetchImpl = mockGraphql(SAVED);
    await saveAutomation(clientWith(fetchImpl), {
      ...baseInput(),
      spaceId: "GENERAL",
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[1][1] as { body: string }).body,
    ) as { variables: { input: { spaceId: string } } };
    expect(body.variables.input.spaceId).toBe("space-1");
  });

  it("resolves documentBinding.spaceId too", async () => {
    const fetchImpl = mockGraphql(SAVED);
    await saveAutomation(clientWith(fetchImpl), {
      ...baseInput(),
      documentBinding: {
        mode: "create" as const,
        genre: "report",
        title: "Weekly",
        spaceId: "general",
      },
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[1][1] as { body: string }).body,
    ) as {
      variables: {
        input: { targetSpec: { documentBinding: { spaceId: string } } };
      };
    };
    expect(body.variables.input.targetSpec.documentBinding.spaceId).toBe(
      "space-1",
    );
  });

  it("an unknown Space fails BEFORE the mutation and lists the tenant's Spaces", async () => {
    const fetchImpl = mockGraphql(SAVED);
    await expect(
      saveAutomation(clientWith(fetchImpl), {
        ...baseInput(),
        spaceId: "marketing",
      }),
    ).rejects.toThrow(/does not match any active Space.*General.*space-1/s);
    // Only the spaces lookup fired — the save never went out.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAutomation", () => {
  it("POSTs deleteAgentLoop with the automation id", async () => {
    // deleteAutomation makes no spaces lookup — plain single-response mock.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { deleteAgentLoop: { id: "loop-1", ok: true } } }),
      );
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
