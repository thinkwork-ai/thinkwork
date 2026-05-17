/**
 * Integration: the single-thread `thread(id)` resolver enforces tenant
 * pinning on BOTH the outer `threads` query AND the nested
 * `thread_attachments` query. Without this, a Cognito user with a valid
 * JWT for tenant A can pass any thread UUID and read tenant B's thread
 * record plus all of its attachment metadata.
 *
 * Strategy: stub `db` and `resolveCallerTenantId`. Build a query harness
 * that captures the predicate columns/values so we can assert tenant pins
 * appeared on both the outer threads filter and the nested attachments
 * filter. apikey callers are exercised as a service-to-service bypass
 * because they were never blocked (matching the bypass in threads.query).
 *
 * Regression guard for the P0 SECURITY carve-out from the finance pilot
 * plan (docs/plans/2026-05-14-002-feat-finance-analysis-pilot-plan.md, U9).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";
const USER_A = "user-A";
const USER_B = "user-B";

interface ThreadRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  title: string;
  status: string;
  channel: string;
  created_at: Date;
  updated_at: Date;
}

interface AttachmentRow {
  id: string;
  thread_id: string;
  tenant_id: string;
  name: string;
  s3_key: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: Date;
}

const THREAD_A: ThreadRow = {
  id: "thread-A",
  tenant_id: TENANT_A,
  user_id: USER_A,
  title: "Tenant A thread",
  status: "in_progress",
  channel: "chat",
  created_at: new Date("2026-05-14T10:00:00Z"),
  updated_at: new Date("2026-05-14T10:05:00Z"),
};
const THREAD_B: ThreadRow = {
  id: "thread-B",
  tenant_id: TENANT_B,
  user_id: USER_B,
  title: "Tenant B thread",
  status: "in_progress",
  channel: "chat",
  created_at: new Date("2026-05-14T10:10:00Z"),
  updated_at: new Date("2026-05-14T10:11:00Z"),
};
const A_ATTACHMENT: AttachmentRow = {
  id: "att-A1",
  thread_id: "thread-A",
  tenant_id: TENANT_A,
  name: "tenant-A-finance.xlsx",
  s3_key: "tenants/tenant-A/threads/thread-A/attachments/att-A1/file.xlsx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size_bytes: 1234,
  uploaded_by: "user-A",
  created_at: new Date("2026-05-14T10:01:00Z"),
};
const B_ATTACHMENT: AttachmentRow = {
  id: "att-B1",
  thread_id: "thread-B",
  tenant_id: TENANT_B,
  name: "tenant-B-internal.xlsx",
  s3_key: "tenants/tenant-B/threads/thread-B/attachments/att-B1/file.xlsx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size_bytes: 5678,
  uploaded_by: "user-B",
  created_at: new Date("2026-05-14T10:12:00Z"),
};

const mocks = vi.hoisted(() => {
  const dbState = {
    threads: [] as ThreadRow[],
    attachments: [] as AttachmentRow[],
    // Records of each SELECT performed so tests can assert pin presence.
    queries: [] as Array<{
      table: "threads" | "thread_attachments";
      eqs: Record<string, unknown>;
    }>,
  };

  function harvestEqs(predicate: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      const obj = node as {
        _op?: string;
        preds?: unknown[];
        column?: { _name?: string };
        value?: unknown;
      };
      if (obj._op === "and" && Array.isArray(obj.preds)) {
        for (const p of obj.preds) walk(p);
      }
      if (
        obj._op === "eq" &&
        obj.column &&
        (obj.column as { _name?: string })._name
      ) {
        const fq = (obj.column as { _name: string })._name;
        out[fq] = obj.value;
        const short = fq.split(".")[1];
        if (short !== undefined && out[short] === undefined)
          out[short] = obj.value;
      }
    }
    walk(predicate);
    return out;
  }

  const eq = vi.fn((column: { _name?: string } | unknown, value: unknown) => ({
    _op: "eq",
    column,
    value,
  }));
  const and = vi.fn((...preds: unknown[]) => ({ _op: "and", preds }));

  const threadsTable = {
    _name: "threads",
    id: { _name: "threads.id" },
    tenant_id: { _name: "threads.tenant_id" },
    user_id: { _name: "threads.user_id" },
  };
  const threadAttachmentsTable = {
    _name: "thread_attachments",
    id: { _name: "thread_attachments.id" },
    thread_id: { _name: "thread_attachments.thread_id" },
    tenant_id: { _name: "thread_attachments.tenant_id" },
  };

  function buildSelect(table: { _name?: string }) {
    const tableName = table?._name ?? "";
    const isThreads = tableName === "threads";
    const isAttachments = tableName === "thread_attachments";
    let captured: Record<string, unknown> = {};

    const builder: Record<string, unknown> = {
      from: () => builder,
      where(predicate: unknown) {
        captured = harvestEqs(predicate);
        dbState.queries.push({
          table: isThreads ? "threads" : "thread_attachments",
          eqs: { ...captured },
        });
        return builder;
      },
      then(onFulfilled: (rows: unknown[]) => unknown) {
        return Promise.resolve(resolveRows()).then(onFulfilled);
      },
    };

    function resolveRows(): unknown[] {
      if (isThreads) {
        return dbState.threads.filter((r) => {
          if (captured.id !== undefined && r.id !== captured.id) return false;
          if (
            captured.tenant_id !== undefined &&
            r.tenant_id !== captured.tenant_id
          ) {
            return false;
          }
          return true;
        });
      }
      if (isAttachments) {
        return dbState.attachments.filter((r) => {
          if (
            captured.thread_id !== undefined &&
            r.thread_id !== captured.thread_id
          ) {
            return false;
          }
          if (
            captured.tenant_id !== undefined &&
            r.tenant_id !== captured.tenant_id
          ) {
            return false;
          }
          return true;
        });
      }
      return [];
    }

    return builder;
  }

  const db = {
    select: vi.fn(() => ({ from: buildSelect })),
  };

  // Literal default — vi.hoisted runs before module-level const initializers,
  // so we can't read TENANT_A here. Tests override via callerTenantImpl.current.
  const callerTenantImpl = { current: "tenant-A" as string | null };
  const resolveCallerTenantId = vi.fn(async () => callerTenantImpl.current);
  const callerUserImpl = { current: "user-A" as string | null };
  const resolveCallerUserId = vi.fn(async () => callerUserImpl.current);
  const requireTenantAdmin = vi.fn<() => Promise<"owner" | "admin">>(
    async () => {
      throw new GraphQLError("Tenant admin role required");
    },
  );

  // snakeToCamel + threadToCamel mirrors of the real helpers — verifying
  // shape mapping is not the focus of this test, but the resolver requires
  // them to return objects so the assertion site doesn't crash.
  const snakeToCamel = (row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[camel] = v;
    }
    return out;
  };
  const threadToCamel = (row: Record<string, unknown>) => snakeToCamel(row);

  return {
    dbState,
    callerTenantImpl,
    callerUserImpl,
    eq,
    and,
    db,
    resolveCallerTenantId,
    resolveCallerUserId,
    requireTenantAdmin,
    threadsTable,
    threadAttachmentsTable,
    snakeToCamel,
    threadToCamel,
  };
});

vi.mock("../../src/graphql/utils.js", () => ({
  db: mocks.db,
  eq: mocks.eq,
  and: mocks.and,
  threads: mocks.threadsTable,
  threadAttachments: mocks.threadAttachmentsTable,
  snakeToCamel: mocks.snakeToCamel,
  threadToCamel: mocks.threadToCamel,
}));

vi.mock("../../src/graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mocks.resolveCallerTenantId,
  resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("../../src/graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mocks.requireTenantAdmin,
}));

import { thread } from "../../src/graphql/resolvers/threads/thread.query.js";

const cognitoCtx = (principalId = "principal-A") =>
  ({ auth: { authType: "cognito", principalId } }) as unknown as Parameters<
    typeof thread
  >[2];
const apikeyCtx = {
  auth: { authType: "apikey", principalId: "service-x" },
} as unknown as Parameters<typeof thread>[2];

describe("thread(id) resolver — tenant pinning", () => {
  beforeEach(() => {
    mocks.dbState.threads = [THREAD_A, THREAD_B];
    mocks.dbState.attachments = [A_ATTACHMENT, B_ATTACHMENT];
    mocks.dbState.queries.length = 0;
    mocks.callerTenantImpl.current = TENANT_A;
    mocks.callerUserImpl.current = USER_A;
    mocks.db.select.mockClear();
    mocks.resolveCallerTenantId.mockClear();
    mocks.resolveCallerUserId.mockClear();
    mocks.requireTenantAdmin.mockReset();
    mocks.requireTenantAdmin.mockRejectedValue(
      new GraphQLError("Tenant admin role required"),
    );
  });

  it("returns the in-tenant thread with its in-tenant attachments", async () => {
    const result = (await thread(null, { id: "thread-A" }, cognitoCtx())) as {
      id: string;
      attachments: Array<{
        id: string;
        tenantId?: string;
        s3Key?: string;
        s3_key?: string;
      }>;
    } | null;

    expect(result).not.toBeNull();
    expect(result!.id).toBe("thread-A");
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments[0]!.id).toBe("att-A1");

    // s3Key removal: schema was changed to drop the field. The resolver
    // destructures s3_key from the DB row before snakeToCamel, so the
    // returned attachment object must contain neither `s3Key` (post-camel)
    // nor `s3_key` (pre-camel). A regression that either restores the field
    // on the schema or removes the resolver-side strip would surface here.
    expect(result!.attachments[0]).not.toHaveProperty("s3Key");
    expect(result!.attachments[0]).not.toHaveProperty("s3_key");

    // Outer threads query was tenant-pinned.
    const threadsQuery = mocks.dbState.queries.find(
      (q) => q.table === "threads",
    );
    expect(threadsQuery).toBeDefined();
    expect(threadsQuery!.eqs["threads.tenant_id"]).toBe(TENANT_A);
    expect(threadsQuery!.eqs["threads.id"]).toBe("thread-A");

    // Nested attachments query was tenant-pinned (defense-in-depth).
    const attachmentsQuery = mocks.dbState.queries.find(
      (q) => q.table === "thread_attachments",
    );
    expect(attachmentsQuery).toBeDefined();
    expect(attachmentsQuery!.eqs["thread_attachments.tenant_id"]).toBe(
      TENANT_A,
    );
    expect(attachmentsQuery!.eqs["thread_attachments.thread_id"]).toBe(
      "thread-A",
    );
  });

  it("returns null when a Cognito caller in tenant A probes a thread in tenant B (cross-tenant defense, outer)", async () => {
    mocks.callerTenantImpl.current = TENANT_A;
    const result = await thread(null, { id: "thread-B" }, cognitoCtx());
    expect(result).toBeNull();

    // Outer pin filtered tenant-B row out → null shape identical to
    // "thread does not exist", eliminating the enumeration oracle.
    const threadsQuery = mocks.dbState.queries.find(
      (q) => q.table === "threads",
    );
    expect(threadsQuery!.eqs["threads.tenant_id"]).toBe(TENANT_A);
    // And no attachments query is issued once the outer row is missing.
    expect(
      mocks.dbState.queries.some((q) => q.table === "thread_attachments"),
    ).toBe(false);
  });

  it("returns null for unknown thread id (same shape as cross-tenant)", async () => {
    const result = await thread(null, { id: "thread-XYZ" }, cognitoCtx());
    expect(result).toBeNull();
  });

  it("returns null when another user in the same tenant probes the thread", async () => {
    mocks.callerUserImpl.current = USER_B;
    const result = await thread(
      null,
      { id: "thread-A" },
      cognitoCtx("principal-B"),
    );
    expect(result).toBeNull();
  });

  it("lets tenant admins read another user's thread detail", async () => {
    mocks.callerUserImpl.current = USER_B;
    mocks.requireTenantAdmin.mockImplementation(async () => "admin");
    const result = (await thread(
      null,
      { id: "thread-A" },
      cognitoCtx("principal-B"),
    )) as { id: string } | null;
    expect(result).not.toBeNull();
    expect(result!.id).toBe("thread-A");
  });

  it("returns null when caller tenant cannot be resolved (Google-federated path with no membership match)", async () => {
    // resolveCallerTenantId may return null for a Cognito JWT whose
    // principal has no users row and no email-fallback match. Fail
    // closed instead of returning the row unfiltered.
    mocks.callerTenantImpl.current = null;
    const result = await thread(null, { id: "thread-A" }, cognitoCtx());
    expect(result).toBeNull();
    // Should NOT have issued any DB query if tenant resolution failed.
    expect(mocks.dbState.queries).toHaveLength(0);
  });

  it("uses resolveCallerTenantId (not ctx.auth.tenantId) so Google-federated callers are pinned", async () => {
    // Google-federated Cognito JWTs land with ctx.auth.tenantId === null.
    // The resolver must consult resolveCallerTenantId (email-fallback
    // lookup) rather than reading ctx.auth.tenantId directly. We assert
    // this by verifying resolveCallerTenantId is invoked exactly once.
    mocks.callerTenantImpl.current = TENANT_A;
    await thread(null, { id: "thread-A" }, cognitoCtx());
    expect(mocks.resolveCallerTenantId).toHaveBeenCalledTimes(1);
  });

  it("pins by resolveCallerTenantId's return value even when ctx.auth.tenantId carries a different tenant", async () => {
    // Threat model: a future regression replaces resolveCallerTenantId(ctx)
    // with ctx.auth.tenantId. For Google-federated callers the auth.tenantId
    // field is null today, but a stale custom-claim (or a misconfigured
    // pre-token-trigger) could populate it with the *wrong* tenant. The
    // pin must always trust the email-fallback resolver's result.
    mocks.callerTenantImpl.current = TENANT_A;
    const ctxWithStaleTenantClaim = {
      auth: {
        authType: "cognito",
        principalId: "principal-A",
        // Intentionally set to TENANT_B — the OLD/WRONG tenant. The
        // resolver must NOT use this; it must use the resolved TENANT_A.
        tenantId: TENANT_B,
      },
    } as unknown as Parameters<typeof thread>[2];

    const result = await thread(
      null,
      { id: "thread-A" },
      ctxWithStaleTenantClaim,
    );
    expect(result).not.toBeNull();

    // The DB query must have pinned by TENANT_A (resolver result), not
    // TENANT_B (stale ctx claim).
    const threadsQuery = mocks.dbState.queries.find(
      (q) => q.table === "threads",
    );
    expect(threadsQuery!.eqs["threads.tenant_id"]).toBe(TENANT_A);
    expect(threadsQuery!.eqs["threads.tenant_id"]).not.toBe(TENANT_B);

    const attachmentsQuery = mocks.dbState.queries.find(
      (q) => q.table === "thread_attachments",
    );
    expect(attachmentsQuery!.eqs["thread_attachments.tenant_id"]).toBe(
      TENANT_A,
    );
  });

  it("nested attachments query is tenant-pinned even when the outer row matches (defense-in-depth)", async () => {
    // Even with the outer pin in place, the nested query must independently
    // filter by tenant_id — protecting against a future code path that
    // resolves a Thread row through a different entrypoint (e.g. a loader
    // that loses the tenant pin) and then asks for `.attachments`.
    await thread(null, { id: "thread-A" }, cognitoCtx());

    const attachmentsQuery = mocks.dbState.queries.find(
      (q) => q.table === "thread_attachments",
    );
    expect(attachmentsQuery!.eqs["thread_attachments.tenant_id"]).toBe(
      TENANT_A,
    );
  });

  it("apikey callers bypass tenant pinning (service-to-service trust boundary)", async () => {
    // Mirrors the bypass in threads.query.ts: apikey is the trusted
    // service-to-service boundary, pre-authorized by the shared secret.
    // They MUST be able to read any tenant's thread for system functions
    // like background drain, audit drain, etc.
    const result = (await thread(null, { id: "thread-B" }, apikeyCtx)) as {
      id: string;
      attachments: Array<{ id: string }>;
    } | null;
    expect(result).not.toBeNull();
    expect(result!.id).toBe("thread-B");
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments[0]!.id).toBe("att-B1");

    // resolveCallerTenantId is NOT called for apikey callers.
    expect(mocks.resolveCallerTenantId).not.toHaveBeenCalled();
    // And the DB filter does NOT include a threads.tenant_id eq (the
    // apikey path falls through to id-only filtering).
    const threadsQuery = mocks.dbState.queries.find(
      (q) => q.table === "threads",
    );
    expect(threadsQuery!.eqs["threads.tenant_id"]).toBeUndefined();
    // Symmetric defense-in-depth check: the nested attachments query also
    // falls through to thread_id-only filtering for apikey callers. If a
    // future change adds a tenant guard to one query but not the other,
    // apikey reads on attachments would silently break (or, worse, the
    // outer pin would be added without the nested one — leaking attachment
    // metadata across tenants for non-apikey callers).
    const attachmentsQuery = mocks.dbState.queries.find(
      (q) => q.table === "thread_attachments",
    );
    expect(
      attachmentsQuery!.eqs["thread_attachments.tenant_id"],
    ).toBeUndefined();
  });
});
