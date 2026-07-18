import { describe, expect, it, vi } from "vitest";
import { publishAppSyncMutation } from "./appsync-iam-publisher.js";

const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret-example",
  sessionToken: "session-example",
};

describe("AppSync IAM publisher", () => {
  it("SigV4 signs a notification mutation without an API key", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
        expect(headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
        expect(headers["x-amz-security-token"]).toBe("session-example");
        expect(headers).not.toHaveProperty("x-api-key");
        return new Response(JSON.stringify({ data: { notifyOrgUpdate: {} } }), {
          status: 200,
        });
      },
    );
    await expect(
      publishAppSyncMutation(
        "mutation { notifyOrgUpdate }",
        { tenantId: "t1" },
        {
          endpoint:
            "https://api-id.appsync-api.us-east-1.amazonaws.com/graphql",
          region: "us-east-1",
          credentials,
          fetchImpl: fetchImpl as typeof fetch,
          suppressor: async () => false,
        },
      ),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed when endpoint configuration is absent", async () => {
    await expect(
      publishAppSyncMutation(
        "mutation { notifyOrgUpdate }",
        {},
        {
          endpoint: "",
          region: "us-east-1",
          credentials,
        },
      ),
    ).resolves.toBe(false);
  });

  it("returns false for HTTP or GraphQL rejection without logging the body", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "sensitive detail" }] }),
          {
            status: 200,
          },
        ),
    );
    await expect(
      publishAppSyncMutation(
        "mutation { notifyOrgUpdate }",
        {},
        {
          endpoint:
            "https://api-id.appsync-api.us-east-1.amazonaws.com/graphql",
          region: "us-east-1",
          credentials,
          fetchImpl: fetchImpl as typeof fetch,
        },
      ),
    ).resolves.toBe(false);
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(
      "sensitive detail",
    );
    errorSpy.mockRestore();
  });

  it("suppresses all tenant delivery while revocation invalidation is pending", async () => {
    const fetchImpl = vi.fn();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await expect(
      publishAppSyncMutation(
        "mutation { notifyNewMessage }",
        { tenantId: "tenant-1", threadId: "thread-1" },
        {
          endpoint:
            "https://api-id.appsync-api.us-east-1.amazonaws.com/graphql",
          region: "us-east-1",
          credentials,
          fetchImpl: fetchImpl as typeof fetch,
          suppressor: async () => true,
        },
      ),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("allows the invalidation mutation itself to bypass suppression", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"data":{}}'));
    const suppressor = vi.fn(async () => true);
    await expect(
      publishAppSyncMutation(
        "mutation { invalidateSubscription }",
        { tenantId: "tenant-1" },
        {
          endpoint:
            "https://api-id.appsync-api.us-east-1.amazonaws.com/graphql",
          region: "us-east-1",
          credentials,
          fetchImpl: fetchImpl as typeof fetch,
          suppressor,
          skipSuppression: true,
        },
      ),
    ).resolves.toBe(true);
    expect(suppressor).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
