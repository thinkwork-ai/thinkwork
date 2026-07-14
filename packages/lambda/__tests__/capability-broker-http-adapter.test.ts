import { describe, it, expect } from "vitest";

import type {
  CanonicalJson,
  OperationContract,
} from "@thinkwork/capability-contracts";

import {
  createHttpOpenapiAdapter,
  type DurableSink,
} from "../lib/capability-broker/adapters/http-openapi.js";
import type { AdapterDispatchContext } from "../lib/capability-broker/adapters/registry.js";
import type { ResolvedCredential } from "../lib/capability-broker/credential-resolver.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUE_OUTPUT: CanonicalJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    number: { type: "integer" },
    title: { type: "string", maxLength: 1024 },
    state: { type: "string", maxLength: 32 },
    user: {
      type: "object",
      additionalProperties: false,
      properties: { login: { type: "string", maxLength: 256 } },
    },
  },
};

function issuesListContract(
  overrides: Partial<OperationContract> = {},
): OperationContract {
  return {
    operationId: "issues.list",
    summary: "List issues",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: {
        method: "GET",
        host: "api.github.com",
        path: "/repos/acme/widgets/issues",
        fixedQuery: { per_page: "50" },
        allowedQuery: ["state", "page"],
        credential: {
          name: "github",
          field: "token",
          placement: "header",
          param: "Authorization",
          scheme: "Bearer",
        },
        maxResponseBytes: 64 * 1024,
        onExceed: "durable",
      },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        state: { type: "string", enum: ["open", "closed", "all"] },
        page: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    outputSchema: { type: "array", maxItems: 50, items: ISSUE_OUTPUT },
    inputDataClass: "internal",
    outputDataClass: "public",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

const CREDS: Record<string, ResolvedCredential> = {
  github: { token: "ghp_secrettokenvalue0123456789" },
};

function ctx(
  contract: OperationContract,
  input: CanonicalJson,
  overrides: Partial<AdapterDispatchContext> = {},
): AdapterDispatchContext {
  return {
    tenantId: "tenant-1",
    operationRef:
      "twcap://acme/connection/github-rest/versions/1/operations/x?contract=sha256:" +
      "a".repeat(64),
    contract,
    input,
    principal: { mode: "service", subjectId: "sp-1" },
    credentialRefs: { github: "secret-ref://gh" },
    credentials: CREDS,
    provenance: {
      routineExecutionId: "run-1",
      threadTurnId: "turn-1",
      brokerCallId: "call-1",
    },
    deadlineEpochMs: Date.now() + 10_000,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------------------------------------------------------------

describe("http-openapi adapter", () => {
  it("happy path: requests the admitted host/path/page size and returns projected safe fields", async () => {
    const seen: { url: string; method?: string; auth?: string } = { url: "" };
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      seen.url = String(input);
      seen.method = init?.method;
      seen.auth = (init?.headers as Record<string, string>)?.Authorization;
      return jsonResponse(200, [
        {
          number: 12,
          title: "bug",
          state: "open",
          user: { login: "octocat" },
          // Provider-only noise that must be dropped by projection:
          body: "secret internal notes",
          author_association: "MEMBER",
        },
      ]);
    }) as unknown as typeof fetch;

    const adapter = createHttpOpenapiAdapter({ fetchImpl });
    const out = await adapter.dispatch(
      ctx(issuesListContract(), { state: "open", page: 1 }),
    );

    expect(out.status).toBe("completed");
    if (out.status === "completed") {
      expect(out.data).toEqual([
        { number: 12, title: "bug", state: "open", user: { login: "octocat" } },
      ]);
    }
    const url = new URL(seen.url);
    expect(url.hostname).toBe("api.github.com");
    expect(url.pathname).toBe("/repos/acme/widgets/issues");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("state")).toBe("open");
    expect(seen.method).toBe("GET");
    // Credential placed in the Authorization header with the Bearer scheme.
    expect(seen.auth).toBe("Bearer ghp_secrettokenvalue0123456789");
  });

  it("dispatches a PUBLIC credential-less binding with no auth injected", async () => {
    const seen: { url: string; authHeader?: string; hasCredParam: boolean } = {
      url: "",
      hasCredParam: false,
    };
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      seen.url = String(input);
      seen.authHeader = (
        init?.headers as Record<string, string>
      )?.Authorization;
      seen.hasCredParam = new URL(String(input)).searchParams.has("token");
      return jsonResponse(200, [
        {
          number: 7,
          title: "public",
          state: "open",
          user: { login: "octocat" },
        },
      ]);
    }) as unknown as typeof fetch;

    // Public operation: resourceSelector carries NO credential block.
    const publicContract = issuesListContract();
    (
      publicContract.targetScope as {
        resourceSelector: Record<string, unknown>;
      }
    ).resourceSelector = {
      method: "GET",
      host: "api.github.com",
      path: "/repos/facebook/react/issues",
      fixedQuery: { per_page: "50" },
      allowedQuery: ["state", "page"],
      maxResponseBytes: 64 * 1024,
      onExceed: "durable",
    };

    const adapter = createHttpOpenapiAdapter({ fetchImpl });
    const out = await adapter.dispatch(
      // No resolved credentials at all — a public binding needs none.
      ctx(publicContract, { state: "open", page: 1 }, { credentials: {} }),
    );

    expect(out.status).toBe("completed");
    expect(seen.authHeader).toBeUndefined();
    expect(seen.hasCredParam).toBe(false);
    expect(new URL(seen.url).pathname).toBe("/repos/facebook/react/issues");
  });

  it("cannot be steered to a different host/path/method via authored input", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return jsonResponse(200, []);
    }) as unknown as typeof fetch;
    const adapter = createHttpOpenapiAdapter({ fetchImpl });
    // Extra keys (host/url/method) are rejected by additionalProperties:false.
    const out = await adapter.dispatch(
      ctx(issuesListContract(), {
        host: "evil.example.com",
        url: "https://evil.example.com/x",
        method: "DELETE",
      } as unknown as CanonicalJson),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("invalid_request");
    expect(called).toBe(false);
  });

  it("refuses an open_world (non-closed) scope", async () => {
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: (async () => jsonResponse(200, [])) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(
      ctx(issuesListContract({ targetScope: { kind: "open_world" } }), {}),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("adapter_error");
  });

  it("fails readiness_blocked when the bound credential is unavailable", async () => {
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: (async () => jsonResponse(200, [])) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(
      ctx(issuesListContract(), {}, { credentials: {} }),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("readiness_blocked");
  });

  it("maps 401 to a non-retryable readiness_blocked without provider detail", async () => {
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: (async () =>
        jsonResponse(401, {
          message: "Bad credentials ghp_secrettokenvalue0123456789",
        })) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(ctx(issuesListContract(), {}));
    expect(out.status).toBe("failed");
    if (out.status === "failed") {
      expect(out.category).toBe("readiness_blocked");
      expect(out.retryable).toBe(false);
      expect(out.message).not.toContain("ghp_secrettokenvalue0123456789");
      expect(out.message).not.toContain("Bad credentials");
    }
  });

  it("retries an idempotent op on 429 then returns rate_limited", async () => {
    let calls = 0;
    const adapter = createHttpOpenapiAdapter({
      backoffMs: [0, 0, 0],
      sleep: async () => {},
      fetchImpl: (async () => {
        calls++;
        return jsonResponse(429, { message: "rate limited" });
      }) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(ctx(issuesListContract(), {}));
    expect(calls).toBe(4); // initial + 3 retries
    expect(out.status).toBe("failed");
    if (out.status === "failed") {
      expect(out.category).toBe("rate_limited");
      expect(out.retryable).toBe(true);
    }
  });

  it("never auto-retries a non-idempotent op (AE7: exactly one provider call)", async () => {
    let calls = 0;
    const adapter = createHttpOpenapiAdapter({
      backoffMs: [0, 0, 0],
      sleep: async () => {},
      fetchImpl: (async () => {
        calls++;
        return jsonResponse(429, { message: "rate limited" });
      }) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(
      ctx(
        issuesListContract({ effect: "create", idempotency: "non_idempotent" }),
        {},
      ),
    );
    expect(calls).toBe(1); // no retry — a non-idempotent effect runs once
    expect(out.status).toBe("failed");
    if (out.status === "failed") {
      expect(out.category).toBe("rate_limited");
      expect(out.retryable).toBe(false);
    }
  });

  it("times out via the deadline abort signal", async () => {
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        })) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(
      ctx(issuesListContract(), {}, { deadlineEpochMs: Date.now() + 20 }),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("timeout");
  });

  it("maps an output-schema violation to adapter_error", async () => {
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: (async () =>
        jsonResponse(200, [
          { number: "not-an-integer", title: "x", state: "open" },
        ])) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(ctx(issuesListContract(), {}));
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("adapter_error");
  });

  // A contract whose inline cap is small enough to be crossed by a schema-valid
  // projected page (titles must stay within the 1024 maxLength).
  function smallCapListContract(onExceed: "durable" | "fail") {
    const base = issuesListContract();
    const sel = (
      base.targetScope as { resourceSelector: Record<string, unknown> }
    ).resourceSelector;
    return issuesListContract({
      targetScope: {
        kind: "closed",
        resourceSelector: { ...sel, maxResponseBytes: 4096, onExceed },
      },
    });
  }

  const bigPage = Array.from({ length: 50 }, (_v, i) => ({
    number: i,
    title: "t".repeat(500),
    state: "open",
    user: { login: "octocat" },
  }));

  it("emits a durable reference when the projected result crosses the cap", async () => {
    const sink: DurableSink = {
      put: async () => ({ ref: "s3://bucket/key", byteLength: 999_999 }),
    };
    const adapter = createHttpOpenapiAdapter({
      durableSink: sink,
      fetchImpl: (async () =>
        jsonResponse(200, bigPage)) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(
      ctx(smallCapListContract("durable"), {}),
    );
    expect(out.status).toBe("completed");
    if (out.status === "completed") {
      expect(out.data).toBeUndefined();
      expect(out.durable).toEqual({
        kind: "s3",
        ref: "s3://bucket/key",
        contentType: "application/json",
        byteLength: 999_999,
      });
    }
  });

  it("fails (never inlines) when over cap with no durable sink", async () => {
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: (async () =>
        jsonResponse(200, bigPage)) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(
      ctx(smallCapListContract("durable"), {}),
    );
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.category).toBe("adapter_error");
  });

  it("substitutes an integer path param safely for issue detail", async () => {
    let seenUrl = "";
    const detail = issuesListContract({
      operationId: "issues.get",
      targetScope: {
        kind: "closed",
        resourceSelector: {
          method: "GET",
          host: "api.github.com",
          path: "/repos/acme/widgets/issues/{issueNumber}",
          pathParams: { issueNumber: "issueNumber" },
          credential: {
            name: "github",
            field: "token",
            placement: "header",
            param: "Authorization",
            scheme: "Bearer",
          },
          maxResponseBytes: 32 * 1024,
          onExceed: "fail",
        },
      },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["issueNumber"],
        properties: { issueNumber: { type: "integer", minimum: 1 } },
      },
      outputSchema: ISSUE_OUTPUT,
    });
    const adapter = createHttpOpenapiAdapter({
      fetchImpl: (async (u: string) => {
        seenUrl = String(u);
        return jsonResponse(200, {
          number: 42,
          title: "x",
          state: "open",
          user: { login: "o" },
        });
      }) as unknown as typeof fetch,
    });
    const out = await adapter.dispatch(ctx(detail, { issueNumber: 42 }));
    expect(out.status).toBe("completed");
    expect(new URL(seenUrl).pathname).toBe("/repos/acme/widgets/issues/42");
  });
});
