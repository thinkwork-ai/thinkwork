/**
 * Unit 5: /api/workspaces/files handler tests.
 *
 * Exercises the security posture (401 unauth, 400 legacy body shape,
 * 404 cross-tenant target, 403 pinned write without accept flag) and the
 * happy-path wiring to the composer + direct-S3 paths.
 *
 * Test strategy:
 *   - Mock Cognito via `authenticate` (from src/lib/cognito-auth.js).
 *   - Mock DB via the same `vi.hoisted` queue pattern workspace-overlay
 *     tests use.
 *   - Mock S3 via aws-sdk-client-mock (so both the handler's S3Client and
 *     the composer's S3Client go through the same mock transport).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// ─── Hoisted DB mock ─────────────────────────────────────────────────────────

const { dbQueue, pushDbRows, resetDbQueue, eqCalls, resetEqCalls } = vi.hoisted(
  () => {
    const queue: unknown[][] = [];
    const calls: { col: unknown; value: unknown }[] = [];
    return {
      dbQueue: queue,
      pushDbRows: (rows: unknown[]) => queue.push(rows),
      resetDbQueue: () => {
        queue.length = 0;
      },
      eqCalls: calls,
      resetEqCalls: () => {
        calls.length = 0;
      },
    };
  },
);

vi.mock("../graphql/utils.js", () => {
  const tableCol = (label: string) => ({ __col: label });
  const chain = () => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
        fn.then = (
          onFulfilled: (v: unknown) => unknown,
          onRejected: (e: unknown) => unknown,
        ) =>
          Promise.resolve(dbQueue.shift() ?? []).then(onFulfilled, onRejected);
        fn.limit = vi
          .fn()
          .mockImplementation(() => Promise.resolve(dbQueue.shift() ?? []));
        return fn;
      }),
    })),
  });
  return {
    db: {
      select: vi.fn().mockImplementation(() => chain()),
      // U5: handler now calls db.transaction(fn) for governance file
      // edits + the post-derive `agent.skills_changed` emit. The
      // emitAuditEvent helper is mocked at module scope so the tx
      // callback only needs a permissive `tx` value — the S3 put
      // inside the callback uses the s3 mock client, not tx.
      transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({} as unknown),
        ),
    },
    eq: (a: unknown, b: unknown) => {
      eqCalls.push({ col: a, value: b });
      return { __eq: [a, b] };
    },
    and: (...args: unknown[]) => ({ __and: args }),
    sql: (strings: unknown, ...args: unknown[]) => ({ __sql: [strings, args] }),
    agents: {
      id: tableCol("agents.id"),
      slug: tableCol("agents.slug"),
      name: tableCol("agents.name"),
      tenant_id: tableCol("agents.tenant_id"),
      template_id: tableCol("agents.template_id"),
      human_pair_id: tableCol("agents.human_pair_id"),
      agent_pinned_versions: tableCol("agents.agent_pinned_versions"),
    },
    agentTemplates: {
      id: tableCol("agent_templates.id"),
      slug: tableCol("agent_templates.slug"),
      tenant_id: tableCol("agent_templates.tenant_id"),
    },
    tenants: {
      id: tableCol("tenants.id"),
      slug: tableCol("tenants.slug"),
      name: tableCol("tenants.name"),
    },
    users: {
      id: tableCol("users.id"),
      email: tableCol("users.email"),
      name: tableCol("users.name"),
      tenant_id: tableCol("users.tenant_id"),
    },
    userProfiles: {
      user_id: tableCol("user_profiles.user_id"),
      title: tableCol("user_profiles.title"),
      timezone: tableCol("user_profiles.timezone"),
      pronouns: tableCol("user_profiles.pronouns"),
    },
    tenantMembers: {
      tenant_id: tableCol("tenant_members.tenant_id"),
      principal_id: tableCol("tenant_members.principal_id"),
      principal_type: tableCol("tenant_members.principal_type"),
      role: tableCol("tenant_members.role"),
      status: tableCol("tenant_members.status"),
    },
  };
});

// ─── Mock authenticate() ─────────────────────────────────────────────────────

const { authMockImpl } = vi.hoisted(() => ({
  authMockImpl: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: authMockImpl,
}));

// ─── Mock regenerateManifest to a noop ───────────────────────────────────────

vi.mock("../lib/workspace-manifest.js", () => ({
  regenerateManifest: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock deriveAgentSkills (U11) so handler tests don't need full composer
// playback. Targeted derive-vs-no-derive tests below override the impl.

const { deriveMockImpl } = vi.hoisted(() => ({
  deriveMockImpl: vi.fn(),
}));

vi.mock("../lib/derive-agent-skills.js", () => ({
  deriveAgentSkills: deriveMockImpl,
}));

// ─── Mock emitAuditEvent (U5) so the workspace-files-handler tests
// don't need a working compliance.audit_outbox connection. The
// in-tx audit emit is exercised end-to-end in
// `test/integration/compliance-event-writers/cross-cutting.integration.test.ts`.
// Targeted tx-rollback tests live there; this file only validates
// handler return shapes.
//
// The mock is permissive: emitAuditEvent resolves successfully and
// the tx callback returns whatever the body resolves to. The
// `db.transaction(fn)` mock invokes the callback with a tx
// "facade" that supports the methods the handler actually calls.

const { emitMockImpl } = vi.hoisted(() => ({
  emitMockImpl: vi.fn().mockResolvedValue({
    eventId: "evt-mock",
    outboxId: "outbox-mock",
    redactedFields: [],
  }),
}));

vi.mock("../lib/compliance/emit.js", () => ({
  emitAuditEvent: emitMockImpl,
}));

// ─── S3 mock ─────────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);

process.env.WORKSPACE_BUCKET = "test-bucket";
process.env.COGNITO_USER_POOL_ID = "test-pool";
process.env.COGNITO_APP_CLIENT_IDS = "test-client";

// Import handler AFTER mocks.
import { handler } from "../../workspace-files.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_A = "tenant-a-id";
const TENANT_B = "tenant-b-id";
const AGENT_ID = "agent-marco-id";
const TEMPLATE_ID = "template-exec-id";
const USER_ID = "user-eric-id";
const EMAIL = "eric@acme.com";

function event(body: Record<string, unknown>, authed = true) {
  return {
    headers: authed
      ? { authorization: "Bearer fake-jwt", "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function authOk(
  overrides: { tenantId?: string | null; email?: string | null } = {},
) {
  return {
    principalId: USER_ID,
    tenantId: overrides.tenantId ?? TENANT_A,
    email: overrides.email ?? EMAIL,
    authType: "cognito" as const,
  };
}

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    slug: "marco",
    name: "Marco",
    tenant_id: TENANT_A,
    template_id: TEMPLATE_ID,
    human_pair_id: null,
    agent_pinned_versions: null,
    ...overrides,
  };
}

function templateRowTenantA() {
  return { id: TEMPLATE_ID, slug: "exec-assistant", tenant_id: TENANT_A };
}

function tenantRow(id = TENANT_A, slug = "acme", name = "Acme") {
  return { id, slug, name };
}

function body(content: string) {
  return {
    Body: {
      transformToString: async (_enc?: string) => content,
    } as unknown as never,
  };
}

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

async function parse(result: { statusCode: number; body: string }) {
  return { statusCode: result.statusCode, body: JSON.parse(result.body) };
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  s3Mock.reset();
  resetDbQueue();
  resetEqCalls();
  authMockImpl.mockReset();
  deriveMockImpl.mockReset();
  deriveMockImpl.mockResolvedValue({
    changed: false,
    addedSlugs: [],
    removedSlugs: [],
    agentsMdPathsScanned: [],
    warnings: [],
  });
});

afterEach(() => {
  // Soft assertion: some tests may leave extra rows queued intentionally
  // (e.g. 401 short-circuits before any DB call). Suppress unless we
  // set STRICT.
});

// ─── 1. Auth boundary ────────────────────────────────────────────────────────

describe("auth boundary", () => {
  it("returns 401 when no JWT is provided", async () => {
    authMockImpl.mockResolvedValue(null);
    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID }, false)),
    );
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("returns 401 when the JWT verifier rejects the token", async () => {
    authMockImpl.mockResolvedValue(null);
    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when caller's tenant cannot be resolved from JWT or email", async () => {
    authMockImpl.mockResolvedValue({
      principalId: USER_ID,
      tenantId: null,
      email: null,
      authType: "cognito",
    });
    // resolveCallerFromAuth: byId lookup returns empty, no email fallback.
    pushDbRows([]);
    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/caller tenant/i);
  });
});

// ─── 2. Legacy body shape rejection ──────────────────────────────────────────

describe("legacy body shape", () => {
  it("rejects requests that include tenantSlug (cross-tenant isolation guard)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    const res = await parse(
      await handler(
        event({
          action: "list",
          tenantSlug: "acme",
          instanceId: "marco",
        }),
      ),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/tenantSlug.*instanceId/);
  });

  it("rejects instanceId alone too", async () => {
    authMockImpl.mockResolvedValue(authOk());
    const res = await parse(
      await handler(event({ action: "list", instanceId: "marco" })),
    );
    expect(res.statusCode).toBe(400);
  });
});

// ─── 2b. Service-to-service (apikey) auth ────────────────────────────────────

describe("apikey auth (Strands container path, Unit 7)", () => {
  it("accepts apikey auth with an x-tenant-id header and composes the agent", async () => {
    // apikey callers skip the DB users lookup entirely — resolveCallerFromAuth
    // trusts the x-tenant-id header since the shared service secret is the
    // trust boundary.
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_A,
      email: null,
      authType: "apikey",
    });
    // resolveAgentTarget — new model only does the agent-target lookup;
    // no separate composer.loadAgentContext walk.
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    // The agent prefix is the source of truth. Bootstrap-time
    // substitution baked AGENT_NAME into the bytes, so the handler
    // returns them verbatim.
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/SOUL.md",
      })
      .resolves({
        Body: {
          transformToString: async () => "Hi Marco",
        } as unknown as never,
      });

    const res = await parse(
      await handler(
        event({ action: "get", agentId: AGENT_ID, path: "SOUL.md" }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.content).toBe("Hi Marco");
  });

  it("returns 404 when apikey caller's x-tenant-id does not match the agent's tenant", async () => {
    // Strands container running in tenant B accidentally passes an agentId
    // belonging to tenant A. The composer's DB lookup binds both and
    // returns nothing.
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_B,
      email: null,
      authType: "apikey",
    });
    // resolveAgentTarget: agent belongs to A, mismatches caller's B → null
    pushDbRows([agentRow({ tenant_id: TENANT_A })]);

    const res = await parse(
      await handler(
        event({ action: "get", agentId: AGENT_ID, path: "SOUL.md" }),
      ),
    );
    expect(res.statusCode).toBe(404);
    expect(s3Mock.calls().length).toBe(0);
  });

  it("rejects apikey without any x-tenant-id header (caller tenant unresolvable)", async () => {
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: null,
      email: null,
      authType: "apikey",
    });
    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );
    expect(res.statusCode).toBe(401);
  });
});

// ─── 3. Target selection ─────────────────────────────────────────────────────

describe("target selection", () => {
  it("requires exactly one of agentId / templateId / defaults", async () => {
    authMockImpl.mockResolvedValue(authOk());
    // resolveCallerFromAuth: byId lookup hits users table first.
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    const res = await parse(await handler(event({ action: "list" })));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Exactly one/);
  });

  it("rejects multiple target selectors", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    const res = await parse(
      await handler(
        event({ action: "list", agentId: AGENT_ID, templateId: TEMPLATE_ID }),
      ),
    );
    expect(res.statusCode).toBe(400);
  });
});

// ─── 4. Cross-tenant isolation via agentId ───────────────────────────────────

describe("cross-tenant isolation", () => {
  it("returns 404 when caller's tenant does not match the agent's tenant", async () => {
    // Caller is in TENANT_B, but agent lives in TENANT_A.
    authMockImpl.mockResolvedValue(authOk({ tenantId: TENANT_B }));
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_B }]); // resolveCallerFromAuth
    // resolveAgentTarget queries agents by id; our agent belongs to TENANT_A.
    pushDbRows([agentRow({ tenant_id: TENANT_A })]);
    // resolveAgentTarget checks tenant_id !== tenantId → returns null.

    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Target not found/);
    // No S3 reads should have happened.
    expect(s3Mock.calls().length).toBe(0);
  });
});

// ─── 5. Agent GET / LIST via composer ────────────────────────────────────────

describe("agent GET / LIST", () => {
  it("GET reads directly from the agent prefix and returns { content, source, sha256 }", async () => {
    authMockImpl.mockResolvedValue(authOk());
    // resolveCallerFromAuth
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    // resolveAgentTarget: agents lookup + tenants lookup
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    // Under materialize-at-write-time, the agent prefix has the
    // already-substituted bytes. No template / defaults fallback.
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/IDENTITY.md",
      })
      .resolves(body("Your name is Marco."));

    const res = await parse(
      await handler(
        event({ action: "get", agentId: AGENT_ID, path: "IDENTITY.md" }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe("agent");
    expect(res.body.content).toBe("Your name is Marco.");
    expect(typeof res.body.sha256).toBe("string");
  });

  it("LIST hides built-in tool catalog copies from the editable workspace tree", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/agents/marco/workspace/SOUL.md" },
        {
          Key: "tenants/acme/agents/marco/workspace/skills/web-search/SKILL.md",
        },
        {
          Key: "tenants/acme/agents/marco/workspace/skills/workspace-memory/SKILL.md",
        },
      ],
    });

    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.files.map((f: { path: string }) => f.path)).toEqual([
      "SOUL.md",
      "skills/workspace-memory/SKILL.md",
    ]);
  });
});

// ─── 6. Pinned-file write guard ──────────────────────────────────────────────

describe("pinned-file write guard", () => {
  it("PUT on GUARDRAILS.md via agentId without acceptTemplateUpdate → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
    pushDbRows([agentRow()]); // resolveAgentTarget: agents
    pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
    pushDbRows([{ role: "admin" }]); // callerIsTenantAdmin (U31)

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "GUARDRAILS.md",
          content: "# clobber",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/pinned/i);
    expect(res.body.error).toMatch(/acceptTemplateUpdate/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("PUT on GUARDRAILS.md with acceptTemplateUpdate: true → 200", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]); // U31 role gate
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "GUARDRAILS.md",
          content: "# accepted",
          acceptTemplateUpdate: true,
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
  });

  it("PUT on nested GUARDRAILS.md via agentId without acceptTemplateUpdate → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "expenses/GUARDRAILS.md",
          content: "# clobber",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/pinned/i);
    expect(res.body.error).toMatch(/acceptTemplateUpdate/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("PUT on nested GUARDRAILS.md with acceptTemplateUpdate: true → 200", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "expenses/GUARDRAILS.md",
          content: "# accepted",
          acceptTemplateUpdate: true,
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/expenses/GUARDRAILS.md",
    );
  });

  it("rejects unsafe absolute pinned paths before S3 writes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "/GUARDRAILS.md",
          content: "# no",
          acceptTemplateUpdate: true,
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("PUT on a live file (IDENTITY.md) does NOT require acceptTemplateUpdate", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]); // U31 role gate
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "IDENTITY.md",
          content: "override",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
  });

  it("rejects writes to built-in tool workspace skill paths", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "skills/web-search/SKILL.md",
          content: "# Web Search\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Built-in tools/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it.each([
    "work/inbox/foo.md",
    "review/run_123.needs-human.md",
    "work/runs/run_123/events/completed.json",
    "events/intents/run-completed.json",
    "events/audit/2026-04-25/event.json",
  ])("PUT to protected orchestration path %s returns 403", async (path) => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path,
          content: "nope",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("use orchestration writer");
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("PUT for a Google-federated admin queries tenantMembers by users.id, not Cognito sub", async () => {
    // Regression: PR #565's U31 admin gate passed `auth.principalId`
    // (the Cognito sub) into `callerIsTenantAdmin`, but
    // `tenantMembers.principal_id` holds `users.id`. For Google-federated
    // users `users.id` is a fresh UUID linked by email — sub ≠ users.id —
    // so the role lookup matched zero rows and every save 403'd.
    const COGNITO_SUB = "google-oauth-cognito-sub-not-equal-to-users-id";
    authMockImpl.mockResolvedValue({
      principalId: COGNITO_SUB,
      tenantId: null, // Google JWTs carry no custom:tenant_id
      email: EMAIL,
      authType: "cognito",
    });
    pushDbRows([]); // resolveCallerFromAuth byId — no row for federated sub
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // byEmail fallback
    pushDbRows([agentRow()]); // resolveAgentTarget: agents
    pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
    pushDbRows([{ role: "admin" }]); // U31 role gate
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "IDENTITY.md",
          content: "override",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);

    // The role-gate query MUST bind tenant_members.principal_id to
    // USER_ID (the resolved users.id row), not to the Cognito sub.
    const principalIdEqCalls = eqCalls.filter(
      (c) =>
        (c.col as { __col?: string })?.__col === "tenant_members.principal_id",
    );
    expect(principalIdEqCalls.length).toBeGreaterThan(0);
    for (const call of principalIdEqCalls) {
      expect(call.value).toBe(USER_ID);
      expect(call.value).not.toBe(COGNITO_SUB);
    }
  });
});

// ─── 7. DELETE ───────────────────────────────────────────────────────────────

describe("agent DELETE", () => {
  it("deletes the agent-scoped override and returns 200", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]); // U31 role gate
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
      ),
    );

    expect(res.statusCode).toBe(200);
    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls.length).toBe(1);
    expect(calls[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/IDENTITY.md",
    );
  });
});

// ─── 7b. Composite create-sub-agent ─────────────────────────────────────────

describe("agent create-sub-agent", () => {
  it("creates CONTEXT.md and appends a parent AGENTS.md routing row", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([templateRowTenantA()]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([templateRowTenantA()]);

    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    } as never);
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/AGENTS.md",
      })
      .resolves(
        body(`# Agent Map

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
`),
      );
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "create-sub-agent",
          agentId: AGENT_ID,
          slug: "support",
          contextContent: "# Support\n\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.map((call) => call.args[0].input.Key)).toEqual([
      "tenants/acme/agents/marco/workspace/support/CONTEXT.md",
      "tenants/acme/agents/marco/workspace/AGENTS.md",
    ]);
    expect(String(puts[1].args[0].input.Body)).toContain(
      "| support specialist | support/ | support/CONTEXT.md |  |",
    );
    expect(deriveMockImpl).toHaveBeenCalledWith(
      { tenantId: TENANT_A },
      AGENT_ID,
    );
  });

  it("rejects reserved sub-agent slugs before writing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "create-sub-agent",
          agentId: AGENT_ID,
          slug: "memory",
          contextContent: "# Memory\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/reserved folder name/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("returns 409 when the sub-agent slug collides with an existing top folder", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([templateRowTenantA()]);
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/workspace/expenses/CONTEXT.md",
          },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/_catalog/exec-assistant/workspace/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/_catalog/defaults/workspace/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    } as never);
    s3Mock
      .on(HeadObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/expenses/CONTEXT.md",
      })
      .resolves({});

    const res = await parse(
      await handler(
        event({
          action: "create-sub-agent",
          agentId: AGENT_ID,
          slug: "expenses",
          contextContent: "# Expenses\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });
});

// ─── 8. Template target ──────────────────────────────────────────────────────

describe("template target", () => {
  it("LIST on templateId lists template prefix directly, not via composer", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
    pushDbRows([templateRowTenantA()]); // resolveTemplateTarget: templates
    pushDbRows([tenantRow()]); // resolveTemplateTarget: tenants
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/IDENTITY.md",
        },
        {
          Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/manifest.json",
        },
      ],
    });

    const res = await parse(
      await handler(event({ action: "list", templateId: TEMPLATE_ID })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.files).toEqual([
      {
        path: "IDENTITY.md",
        source: "template",
        sha256: "",
        overridden: false,
      },
    ]);
  });

  it("rejects a template owned by a different tenant with 404", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    // resolveTemplateTarget: template lookup returns a row for TENANT_B.
    pushDbRows([
      { id: TEMPLATE_ID, slug: "other-template", tenant_id: TENANT_B },
    ]);

    const res = await parse(
      await handler(event({ action: "list", templateId: TEMPLATE_ID })),
    );
    expect(res.statusCode).toBe(404);
    expect(s3Mock.calls().length).toBe(0);
  });
});

// ─── 8b. includeContent: the Unit 7 Strands cold-start contract ──────────────

describe("list action includeContent (Strands container cold-start)", () => {
  it("returns files[].content when includeContent=true (container bootstrap)", async () => {
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_A,
      email: null,
      authType: "apikey",
    });
    // resolveAgentTarget — new model only does the agent-target lookup.
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    // The agent prefix has the substituted bytes; the runtime cold-start
    // bootstrap reads them via list+get on this single prefix.
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "tenants/acme/agents/marco/workspace/SOUL.md" }],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/SOUL.md",
      })
      .resolves({
        Body: {
          transformToString: async () => "Hi Marco",
        } as unknown as never,
      });

    const res = await parse(
      await handler(
        event({ action: "list", agentId: AGENT_ID, includeContent: true }),
      ),
    );
    expect(res.statusCode).toBe(200);
    const soul = res.body.files.find(
      (f: { path: string }) => f.path === "SOUL.md",
    );
    expect(soul).toBeDefined();
    expect(soul.content).toBe("Hi Marco");
  });

  it("omits files[].content when includeContent is absent or false", async () => {
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_A,
      email: null,
      authType: "apikey",
    });
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([templateRowTenantA()]);

    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    } as never);

    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.files)).toBe(true);
    for (const f of res.body.files) {
      expect(f.content).toBeUndefined();
    }
  });
});

// ─── 8c. CORS preflight + headers on every response ─────────────────────────

describe("CORS", () => {
  it("short-circuits OPTIONS preflight with 204 + CORS headers before auth", async () => {
    // No auth mock set up — if the handler hit authenticate() it would
    // return 401 and this test would fail.
    authMockImpl.mockResolvedValue(null);
    const preflight = await handler({
      headers: {
        origin: "http://localhost:5175",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
      requestContext: { http: { method: "OPTIONS" } },
      body: null,
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers?.["Access-Control-Allow-Origin"]).toBe("*");
    expect(preflight.headers?.["Access-Control-Allow-Methods"]).toMatch(/POST/);
    expect(preflight.headers?.["Access-Control-Allow-Headers"]).toMatch(
      /authorization/i,
    );
  });

  it("emits Access-Control-Allow-Origin on normal POST responses too", async () => {
    authMockImpl.mockResolvedValue(null);
    const res = await handler({
      headers: {},
      body: JSON.stringify({ action: "list", agentId: AGENT_ID }),
    });
    // 401 (no auth) but CORS headers must still be present or the
    // browser won't even expose the response body to the admin UI.
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
  });
});

// ─── 9. Action validation ────────────────────────────────────────────────────

describe("action validation", () => {
  it("rejects unknown actions", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    const res = await parse(
      await handler(event({ action: "evil", agentId: AGENT_ID })),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Unknown action/);
  });
});

// ─── 10. U31: tenant admin/owner role gate on writes ────────────────────────

describe("U31 role gate (tenant admin/owner required for writes)", () => {
  it("PUT by a member-role caller (not admin/owner) → 403, no S3 write", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
    pushDbRows([agentRow()]); // resolveAgentTarget: agents
    pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
    pushDbRows([{ role: "member" }]); // callerIsTenantAdmin: not admin

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "IDENTITY.md",
          content: "override-attempt",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/admin or owner/i);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("PUT by a caller with no membership row → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([]); // callerIsTenantAdmin: no membership row

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "IDENTITY.md",
          content: "override-attempt",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("DELETE by a member-role caller → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
  });

  it("regenerate-map by a member-role caller → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(event({ action: "regenerate-map", agentId: AGENT_ID })),
    );

    expect(res.statusCode).toBe(403);
  });

  it("update-identity-field by a member-role caller → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({
          action: "update-identity-field",
          agentId: AGENT_ID,
          field: "creature",
          value: "axolotl",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("GET by a member-role caller still succeeds (reads stay open)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
    pushDbRows([agentRow()]); // resolveAgentTarget: agents
    pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
    // NOTE: no tenantMembers row queued — read path must not query it.
    pushDbRows([agentRow()]); // composer.loadAgentContext: agents
    pushDbRows([tenantRow()]); // composer.loadAgentContext: tenants
    pushDbRows([templateRowTenantA()]); // composer.loadAgentContext: templates

    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/IDENTITY.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/IDENTITY.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/defaults/workspace/IDENTITY.md",
      })
      .resolves(body("Your name is {{AGENT_NAME}}."));

    const res = await parse(
      await handler(
        event({ action: "get", agentId: AGENT_ID, path: "IDENTITY.md" }),
      ),
    );
    expect(res.statusCode).toBe(200);
  });

  it("LIST by a member-role caller still succeeds (reads stay open)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([templateRowTenantA()]);
    pushDbRows([tenantRow()]);
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const res = await parse(
      await handler(event({ action: "list", templateId: TEMPLATE_ID })),
    );
    expect(res.statusCode).toBe(200);
  });

  it("apikey caller bypasses the role check on writes (platform-credential trust)", async () => {
    // Strands container path: shared service secret is the trust
    // boundary; per-tenant role doesn't apply.
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_A,
      email: null,
      authType: "apikey",
    });
    pushDbRows([agentRow()]); // resolveAgentTarget: agents
    pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
    // NO tenantMembers row queued — apikey path must short-circuit
    // before calling callerIsTenantAdmin.
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "IDENTITY.md",
          content: "service-write",
        }),
      ),
    );
    expect(res.statusCode).toBe(200);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
  });

  it("admin role passes the gate", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
      ),
    );
    expect(res.statusCode).toBe(200);
  });

  it("owner role passes the gate", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "owner" }]);
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({ action: "delete", agentId: AGENT_ID, path: "IDENTITY.md" }),
      ),
    );
    expect(res.statusCode).toBe(200);
  });
});

// ─── 9. workspace skill marker derive wiring ────────────────────────────────

describe("workspace skills → derive-agent-skills wiring", () => {
  it("PUT on root skills/<slug>/SKILL.md triggers deriveAgentSkills", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});
    deriveMockImpl.mockResolvedValue({
      changed: true,
      addedSlugs: ["approve-receipt"],
      removedSlugs: [],
      agentsMdPathsScanned: ["skills/approve-receipt/SKILL.md"],
      warnings: [],
    });

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "skills/approve-receipt/SKILL.md",
          content: "# Approve receipt\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deriveMockImpl).toHaveBeenCalledTimes(1);
    expect(deriveMockImpl).toHaveBeenCalledWith(
      { tenantId: TENANT_A },
      AGENT_ID,
    );
  });

  it("PUT on a sub-agent skill marker triggers derive", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "expenses/skills/tag-vendor/SKILL.md",
          content: "# Tag vendor\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).toHaveBeenCalledTimes(1);
  });

  it("PUT on CONTEXT.md does NOT trigger derive (path filter)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "CONTEXT.md",
          content: "ignored",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).not.toHaveBeenCalled();
  });

  it("PUT on expenses/CONTEXT.md does NOT trigger derive", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "expenses/CONTEXT.md",
          content: "ignored",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).not.toHaveBeenCalled();
  });

  it("derive failure → 500 with error message; S3 put already happened", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});
    deriveMockImpl.mockRejectedValue(new Error("database unavailable"));

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "skills/approve-receipt/SKILL.md",
          content: "# Approve receipt\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/agent_skills derive failed/);
    expect(res.body.error).toMatch(/database unavailable/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
  });

  it("DELETE on a skill marker triggers derive", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "delete",
          agentId: AGENT_ID,
          path: "skills/approve-receipt/SKILL.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).toHaveBeenCalledTimes(1);
  });

  it("PUT on template skill marker does NOT trigger derive (agent branch only)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([templateRowTenantA()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          templateId: TEMPLATE_ID,
          path: "skills/approve-receipt/SKILL.md",
          content: "ignored",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).not.toHaveBeenCalled();
  });

  it("forwards derive warnings to the success response when derive emits them", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});
    deriveMockImpl.mockResolvedValue({
      changed: false,
      addedSlugs: [],
      removedSlugs: [],
      agentsMdPathsScanned: ["skills/approve-receipt/SKILL.md"],
      warnings: ["workspace skill warning"],
    });

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "skills/approve-receipt/SKILL.md",
          content: "# Approve receipt\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.deriveWarnings).toBeDefined();
    expect(res.body.deriveWarnings.length).toBe(1);
  });
});
