import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KestraClient,
  readKestraRuntimeStatus,
} from "../kestra-control-client.js";

describe("Kestra control client", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    vi.restoreAllMocks();
  });

  it("reads the compact Kestra runtime payload including the basic-auth secret", () => {
    process.env.KESTRA =
      "1|1|https://orchestrate.example.com|cluster|service|logs|bucket|db|arn:aws:secretsmanager:us-east-1:123:secret:thinkwork/dev/kestra/basic";

    expect(readKestraRuntimeStatus()).toEqual({
      provisioned: true,
      runtimeEnabled: true,
      url: "https://orchestrate.example.com",
      basicAuthSecretArn:
        "arn:aws:secretsmanager:us-east-1:123:secret:thinkwork/dev/kestra/basic",
    });
  });

  it("derives URL and basic-auth secret for the compact deployed runtime payload", () => {
    process.env.STAGE = "dev";
    process.env.WWW_URL = "https://thinkwork.ai";
    process.env.KESTRA = "1|1";

    expect(readKestraRuntimeStatus()).toEqual({
      provisioned: true,
      runtimeEnabled: true,
      url: "https://orchestrate.thinkwork.ai",
      basicAuthSecretArn: "thinkwork/dev/kestra/basic-auth",
    });
  });

  it("sends flow YAML with basic auth to the documented flow endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "hello", revision: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new KestraClient({
      endpoint: "https://orchestrate.example.com/",
      credentials: { username: "svc", password: "secret" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.flowUpsert("id: hello\nnamespace: thinkwork.ops\n"),
    ).resolves.toEqual({ id: "hello", revision: 2 });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://orchestrate.example.com/api/v1/main/flows",
      expect.objectContaining({
        method: "POST",
        body: "id: hello\nnamespace: thinkwork.ops\n",
        headers: expect.objectContaining({
          Authorization: "Basic c3ZjOnNlY3JldA==",
          "Content-Type": "application/x-yaml",
        }),
      }),
    );
  });

  it("throws a structured KestraApiError for non-2xx responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("bad credentials should not leak", { status: 401 }),
      );
    const client = new KestraClient({
      endpoint: "https://orchestrate.example.com",
      credentials: { username: "svc", password: "secret" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.executionGet("exec-1")).rejects.toMatchObject({
      name: "KestraApiError",
      data: {
        status: 401,
        method: "GET",
        path: "/api/v1/main/executions/exec-1",
      },
    });
  });
});
