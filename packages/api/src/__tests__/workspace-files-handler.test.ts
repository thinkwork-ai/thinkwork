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
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { computeCatalogSkillSha } from "../lib/catalog-skill-sha.js";

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
    spaces: {
      id: tableCol("spaces.id"),
      slug: tableCol("spaces.slug"),
      tenant_id: tableCol("spaces.tenant_id"),
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
    computers: {
      id: tableCol("computers.id"),
      tenant_id: tableCol("computers.tenant_id"),
    },
    computerTasks: {
      id: tableCol("computer_tasks.id"),
      tenant_id: tableCol("computer_tasks.tenant_id"),
      computer_id: tableCol("computer_tasks.computer_id"),
      status: tableCol("computer_tasks.status"),
      output: tableCol("computer_tasks.output"),
      error: tableCol("computer_tasks.error"),
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

const { bootstrapAgentWorkspaceMock } = vi.hoisted(() => ({
  bootstrapAgentWorkspaceMock: vi.fn(),
}));

vi.mock("../lib/workspace-bootstrap.js", () => ({
  bootstrapAgentWorkspace: bootstrapAgentWorkspaceMock,
}));

// ─── Mock deriveAgentSkills compatibility sync for workspace skill edits.

const { deriveMockImpl } = vi.hoisted(() => ({
  deriveMockImpl: vi.fn(),
}));

vi.mock("../lib/derive-agent-skills.js", () => ({
  deriveAgentSkills: deriveMockImpl,
}));

const { refreshAgentsMdSectionsMock } = vi.hoisted(() => ({
  refreshAgentsMdSectionsMock: vi.fn(),
}));

const { normalizeAgentsMdMock } = vi.hoisted(() => ({
  normalizeAgentsMdMock: vi.fn(),
}));

const { generateContextFolderStructureMock } = vi.hoisted(() => ({
  generateContextFolderStructureMock: vi.fn(),
}));

const { generateContextFolderStructureForSpaceMock } = vi.hoisted(() => ({
  generateContextFolderStructureForSpaceMock: vi.fn(),
}));

vi.mock("../lib/workspace-map-generator.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/workspace-map-generator.js")>();
  return {
    ...actual,
    generateContextFolderStructure: generateContextFolderStructureMock,
    generateContextFolderStructureForSpace:
      generateContextFolderStructureForSpaceMock,
    normalizeAgentsMd: normalizeAgentsMdMock,
    regenerateAgentsMdDerivedSections: refreshAgentsMdSectionsMock,
  };
});

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

const { enqueueComputerTaskMock } = vi.hoisted(() => ({
  enqueueComputerTaskMock: vi.fn(),
}));

vi.mock("../lib/computers/tasks.js", () => ({
  enqueueComputerTask: enqueueComputerTaskMock,
}));

// ─── S3 mock ─────────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);
const lambdaMock = mockClient(LambdaClient);

process.env.WORKSPACE_BUCKET = "test-bucket";
process.env.COGNITO_USER_POOL_ID = "test-pool";
process.env.COGNITO_APP_CLIENT_IDS = "test-client";
process.env.WORKSPACE_FILES_EFS_FN_ARN =
  "arn:aws:lambda:us-east-1:000000000000:function:thinkwork-test-api-workspace-files-efs";

// Import handler AFTER mocks.
import { handler } from "../../workspace-files.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_A = "tenant-a-id";
const TENANT_B = "tenant-b-id";
const AGENT_ID = "agent-marco-id";
const TEMPLATE_ID = "template-exec-id";
const SPACE_ID = "space-eng-id";
const COMPUTER_ID = "computer-marco-id";
const USER_ID = "user-eric-id";
const EMAIL = "eric@acme.com";

// aws-sdk-client-mock accepts Uint8Array for Payload at runtime, but the
// InvokeCommandOutput type signature expects a Uint8ArrayBlobAdapter (the
// adapter wrapping that ships in the real SDK). Local cast keeps the
// per-test sites readable.
function lambdaPayload(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

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

function spaceRowTenantA() {
  return { id: SPACE_ID, slug: "engineering", tenant_id: TENANT_A };
}

function tenantRow(id = TENANT_A, slug = "acme", name = "Acme") {
  return { id, slug, name };
}

function queueAdminAgentTargetRows(): void {
  pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
  pushDbRows([agentRow()]);
  pushDbRows([tenantRow()]);
  pushDbRows([{ role: "admin" }]);
}

function queueAdminTemplateTargetRows(): void {
  pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
  pushDbRows([templateRowTenantA()]);
  pushDbRows([tenantRow()]);
  pushDbRows([{ role: "admin" }]);
}

function queueAdminSpaceTargetRows(): void {
  pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
  pushDbRows([spaceRowTenantA()]);
  pushDbRows([tenantRow()]);
  pushDbRows([{ role: "admin" }]);
}

function queueAdminCatalogTargetRows(): void {
  pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
  pushDbRows([tenantRow()]);
  pushDbRows([{ role: "admin" }]);
}

function computerRow(overrides: Record<string, unknown> = {}) {
  return { id: COMPUTER_ID, tenant_id: TENANT_A, ...overrides };
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
  lambdaMock.reset();
  resetDbQueue();
  resetEqCalls();
  authMockImpl.mockReset();
  enqueueComputerTaskMock.mockReset();
  enqueueComputerTaskMock.mockResolvedValue({ id: "computer-task-1" });
  bootstrapAgentWorkspaceMock.mockReset();
  bootstrapAgentWorkspaceMock.mockResolvedValue({
    agentId: AGENT_ID,
    written: 1,
    skipped: 0,
    total: 1,
  });
  deriveMockImpl.mockReset();
  deriveMockImpl.mockResolvedValue({
    changed: false,
    addedSlugs: [],
    removedSlugs: [],
    agentsMdPathsScanned: [],
    warnings: [],
  });
  refreshAgentsMdSectionsMock.mockReset();
  refreshAgentsMdSectionsMock.mockResolvedValue(undefined);
  normalizeAgentsMdMock.mockReset();
  normalizeAgentsMdMock.mockResolvedValue(undefined);
  generateContextFolderStructureMock.mockReset();
  generateContextFolderStructureMock.mockResolvedValue(undefined);
  generateContextFolderStructureForSpaceMock.mockReset();
  generateContextFolderStructureForSpaceMock.mockResolvedValue(undefined);
});

afterEach(() => {
  // Soft assertion: some tests may leave extra rows queued intentionally
  // (e.g. 401 short-circuits before any DB call). Suppress unless we
  // set STRICT.
});

describe("agent AGENTS.md derived section refresh", () => {
  it("refreshes derived sections after an agent file put", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "memory/note.md",
          content: "hello",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("does not refresh AGENTS.md sections for template writes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminTemplateTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          templateId: TEMPLATE_ID,
          path: "memory/note.md",
          content: "hello",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).not.toHaveBeenCalled();
  });

  it("surfaces section-refresh failures after the primary write lands", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    refreshAgentsMdSectionsMock.mockRejectedValueOnce(new Error("S3 slow"));
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "memory/note.md",
          content: "hello",
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/AGENTS\.md section refresh failed/);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it("refreshes derived sections after delete, move, create-sub-agent, and manual regenerate", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    s3Mock.on(DeleteObjectCommand).resolves({});

    const deleteRes = await parse(
      await handler(
        event({ action: "delete", agentId: AGENT_ID, path: "memory/note.md" }),
      ),
    );
    expect(deleteRes.statusCode).toBe(200);

    queueAdminAgentTargetRows();
    s3Mock.resetHistory();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/memory/note.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const moveRes = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "memory/note.md",
          toFolder: "archive",
        }),
      ),
    );
    expect(moveRes.statusCode).toBe(200);

    queueAdminAgentTargetRows();
    s3Mock.resetHistory();
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/AGENTS.md",
      })
      .rejects(noSuchKey());
    s3Mock.on(PutObjectCommand).resolves({});

    const createRes = await parse(
      await handler(
        event({
          action: "create-sub-agent",
          agentId: AGENT_ID,
          slug: "research",
          contextContent: "# Research\n",
        }),
      ),
    );
    expect(createRes.statusCode).toBe(200);

    queueAdminAgentTargetRows();
    const regenRes = await parse(
      await handler(event({ action: "regenerate-map", agentId: AGENT_ID })),
    );
    expect(regenRes.statusCode).toBe(200);

    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledTimes(4);
  });

  it("passes a nested AGENTS.md path through manual regenerate-map", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "regenerate-map",
          agentId: AGENT_ID,
          path: "earnest-falcon-947/AGENTS.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(
      AGENT_ID,
      "earnest-falcon-947/AGENTS.md",
    );
  });

  it("rejects regenerate-map paths that are not AGENTS.md files", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "regenerate-map",
          agentId: AGENT_ID,
          path: "earnest-falcon-947/CONTEXT.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/AGENTS\.md/);
    expect(refreshAgentsMdSectionsMock).not.toHaveBeenCalled();
  });

  it("normalizes AGENTS.md only for agent targets", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const agentRes = await parse(
      await handler(event({ action: "normalize-map", agentId: AGENT_ID })),
    );

    expect(agentRes.statusCode).toBe(200);
    expect(normalizeAgentsMdMock).toHaveBeenCalledTimes(1);
    expect(normalizeAgentsMdMock).toHaveBeenCalledWith(AGENT_ID);

    queueAdminTemplateTargetRows();
    const templateRes = await parse(
      await handler(
        event({ action: "normalize-map", templateId: TEMPLATE_ID }),
      ),
    );

    expect(templateRes.statusCode).toBe(400);
    expect(templateRes.body.error).toMatch(/requires agentId/);
    expect(normalizeAgentsMdMock).toHaveBeenCalledTimes(1);
  });

  it("generates folder structure only for agent CONTEXT.md targets", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const agentRes = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "community/CONTEXT.md",
        }),
      ),
    );

    expect(agentRes.statusCode).toBe(200);
    expect(generateContextFolderStructureMock).toHaveBeenCalledTimes(1);
    expect(generateContextFolderStructureMock).toHaveBeenCalledWith(
      AGENT_ID,
      "community/CONTEXT.md",
    );

    queueAdminAgentTargetRows();
    const nonContextRes = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "community/README.md",
        }),
      ),
    );
    expect(nonContextRes.statusCode).toBe(400);
    expect(nonContextRes.body.error).toMatch(/CONTEXT\.md/);
    expect(generateContextFolderStructureMock).toHaveBeenCalledTimes(1);

    queueAdminTemplateTargetRows();
    const templateRes = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          templateId: TEMPLATE_ID,
          path: "CONTEXT.md",
        }),
      ),
    );
    expect(templateRes.statusCode).toBe(400);
    expect(templateRes.body.error).toMatch(/requires agentId or spaceId/);
    expect(generateContextFolderStructureMock).toHaveBeenCalledTimes(1);
  });

  it("generates folder structure for Space CONTEXT.md targets", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          spaceId: SPACE_ID,
          path: "CONTEXT.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(generateContextFolderStructureForSpaceMock).toHaveBeenCalledTimes(1);
    expect(generateContextFolderStructureForSpaceMock).toHaveBeenCalledWith(
      SPACE_ID,
      "CONTEXT.md",
    );
    expect(generateContextFolderStructureMock).not.toHaveBeenCalled();
  });

  it("rejects non-CONTEXT.md paths on Space targets", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          spaceId: SPACE_ID,
          path: "memory/notes.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/CONTEXT\.md/);
    expect(generateContextFolderStructureForSpaceMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe generate-folder-structure paths before invoking the generator", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "../CONTEXT.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(generateContextFolderStructureMock).not.toHaveBeenCalled();
  });

  it("surfaces generate-folder-structure failures", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    generateContextFolderStructureMock.mockRejectedValueOnce(
      new Error("manifest down"),
    );

    const res = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "CONTEXT.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/manifest down/);
  });

  it("rematerialize refreshes AGENTS.md sections after overwriting template/default files", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const res = await parse(
      await handler(event({ action: "rematerialize", agentId: AGENT_ID })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      agentId: AGENT_ID,
      written: 1,
      skipped: 0,
      total: 1,
    });
    expect(bootstrapAgentWorkspaceMock).toHaveBeenCalledWith(AGENT_ID, {
      mode: "overwrite",
      refreshAgentsMdSections: true,
    });
  });
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

  it("requires apikey generate-folder-structure callers to match x-agent-id", async () => {
    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_A,
      email: null,
      authType: "apikey",
      agentId: "different-agent",
    });
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    const mismatch = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "CONTEXT.md",
        }),
      ),
    );

    expect(mismatch.statusCode).toBe(403);
    expect(generateContextFolderStructureMock).not.toHaveBeenCalled();

    authMockImpl.mockResolvedValue({
      principalId: null,
      tenantId: TENANT_A,
      email: null,
      authType: "apikey",
      agentId: AGENT_ID,
    });
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    const match = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "CONTEXT.md",
        }),
      ),
    );

    expect(match.statusCode).toBe(200);
    expect(generateContextFolderStructureMock).toHaveBeenCalledWith(
      AGENT_ID,
      "CONTEXT.md",
    );
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

  it("reads Space source files from the contextual workroom prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([spaceRowTenantA()]);
    pushDbRows([tenantRow()]);

    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/spaces/engineering/source/AGENTS.md",
      })
      .resolves(body("# Engineering Space"));

    const res = await parse(
      await handler(
        event({ action: "get", spaceId: SPACE_ID, path: "AGENTS.md" }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe("space");
    expect(res.body.content).toBe("# Engineering Space");
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

// ─── 4b. Tenant skill catalog target ────────────────────────────────────────

describe("tenant skill catalog target", () => {
  it("lists and reads files from the tenant skill-catalog prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md" },
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md" },
        { Key: "tenants/acme/skill-catalog/web-search/SKILL.md" },
      ],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
      })
      .resolves(body("# Finance Audit XLS\n"))
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
      })
      .resolves(body("## Wiring\n"));
    const financeSha = computeCatalogSkillSha([
      { relativePath: "SKILL.md", content: "# Finance Audit XLS\n" },
      { relativePath: "WIRING.md", content: "## Wiring\n" },
    ]);

    const listRes = await parse(
      await handler(event({ action: "list", catalog: true })),
    );

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.files).toEqual([
      {
        path: "finance-audit-xls/SKILL.md",
        source: "catalog",
        sha256: financeSha,
        overridden: false,
      },
      {
        path: "finance-audit-xls/WIRING.md",
        source: "catalog",
        sha256: financeSha,
        overridden: false,
      },
    ]);

    queueAdminCatalogTargetRows();
    const getRes = await parse(
      await handler(
        event({
          action: "get",
          catalog: true,
          path: "finance-audit-xls/SKILL.md",
        }),
      ),
    );

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toMatchObject({
      ok: true,
      source: "catalog",
      content: "# Finance Audit XLS\n",
    });
  });

  it("returns an empty list for an empty tenant skill catalog without seeding", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const res = await parse(
      await handler(event({ action: "list", catalog: true })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.files).toEqual([]);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it("writes and deletes catalog files under the tenant skill-catalog prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const putRes = await parse(
      await handler(
        event({
          action: "put",
          catalog: true,
          path: "finance-audit-xls/SKILL.md",
          content: "# Finance Audit XLS\n",
        }),
      ),
    );

    expect(putRes.statusCode).toBe(200);
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
      Body: "# Finance Audit XLS\n",
    });

    queueAdminCatalogTargetRows();
    s3Mock.on(DeleteObjectCommand).resolves({});
    const deleteRes = await parse(
      await handler(
        event({
          action: "delete",
          catalog: true,
          path: "finance-audit-xls/SKILL.md",
        }),
      ),
    );

    expect(deleteRes.statusCode).toBe(200);
    expect(
      s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
    });
  });

  it("requires tenant admin for catalog reads and writes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const listRes = await parse(
      await handler(event({ action: "list", catalog: true })),
    );

    expect(listRes.statusCode).toBe(403);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);

    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const putRes = await parse(
      await handler(
        event({
          action: "put",
          catalog: true,
          path: "finance-audit-xls/SKILL.md",
          content: "# no\n",
        }),
      ),
    );

    expect(putRes.statusCode).toBe(403);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("returns 404 when the caller tenant cannot resolve a catalog prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([]);

    const res = await parse(
      await handler(event({ action: "list", catalog: true })),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Target not found/);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it("rejects catalog writes to built-in tool slugs", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "put",
          catalog: true,
          path: "web-search/SKILL.md",
          content: "# Web Search\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("builtin_tool_slug");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("rejects retired catalog-seed after tenant catalogs are S3-owned", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();

    const res = await parse(
      await handler(event({ action: "catalog-seed", catalog: true })),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("not supported");
  });
});

// ─── 4c. Catalog skill install action ───────────────────────────────────────

function mockCatalogInstallS3(
  targetPrefix = "tenants/acme/agents/marco/workspace/",
): void {
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: "tenants/acme/skill-catalog/finance-audit-xls/",
    })
    .resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md" },
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md" },
      ],
    });
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: `${targetPrefix}skills/finance-audit-xls/`,
    })
    .resolves({ Contents: [] });
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
    })
    .resolves(body("# Finance Audit\n"));
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
    })
    .resolves(
      body(`# Wiring suggestions

## Stage 3 Gate
Use this for stage-three reviews.

\`\`\`context-md
| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |
\`\`\`
`),
    );
  s3Mock
    .on(GetObjectCommand, {
      Key: `${targetPrefix}CONTEXT.md`,
    })
    .resolves(body("# Context\n"));
  s3Mock.on(CopyObjectCommand).resolves({});
  s3Mock.on(PutObjectCommand).resolves({});
}

describe("agent install-skill action", () => {
  it("copies a catalog skill into the agent workspace and refreshes agent state", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    mockCatalogInstallS3();

    const res = await parse(
      await handler(
        event({
          action: "install-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
          wiring_choice: "stage-3-gate",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.installed_paths).toEqual([
      "skills/finance-audit-xls/.catalog-ref.json",
      "skills/finance-audit-xls/SKILL.md",
      "skills/finance-audit-xls/WIRING.md",
    ]);
    expect(
      s3Mock.commandCalls(CopyObjectCommand).map((call) => call.args[0].input),
    ).toEqual([
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/WIRING.md",
      }),
    ]);
    const contextPut = s3Mock
      .commandCalls(PutObjectCommand)
      .find(
        (call) =>
          call.args[0].input.Key ===
          "tenants/acme/agents/marco/workspace/CONTEXT.md",
      );
    expect(String(contextPut?.args[0].input.Body)).toContain(
      "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |",
    );
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("surfaces install worker errors with typed codes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    mockCatalogInstallS3();

    const res = await parse(
      await handler(
        event({
          action: "install-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
          wiring_choice: "always-on",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("wiring_choice_not_found");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("rejects Space skill installs because capabilities belong in agent workspaces", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "install-skill",
          spaceId: SPACE_ID,
          slug: "finance-audit-xls",
          wiring_choice: "stage-3-gate",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("space_capability_file_rejected");
    expect(res.body.error).toMatch(/master\/workspaces/);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(deriveMockImpl).not.toHaveBeenCalled();
    expect(refreshAgentsMdSectionsMock).not.toHaveBeenCalled();
  });

  it("requires tenant admin before installing a skill", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({
          action: "install-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
          wiring_choice: "stage-3-gate",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });
});

// ─── 4d. Catalog skill uninstall action ─────────────────────────────────────

function mockCatalogUninstallS3(
  targetPrefix = "tenants/acme/agents/marco/workspace/",
): void {
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: `${targetPrefix}skills/finance-audit-xls/`,
    })
    .resolves({
      Contents: [
        { Key: `${targetPrefix}skills/finance-audit-xls/.catalog-ref.json` },
        { Key: `${targetPrefix}skills/finance-audit-xls/SKILL.md` },
        { Key: `${targetPrefix}skills/finance-audit-xls/WIRING.md` },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: `${targetPrefix}skills/finance-audit-xls/.catalog-ref.json`,
    })
    .resolves(
      body(
        JSON.stringify({
          slug: "finance-audit-xls",
          source_sha256: "a".repeat(64),
          installed_at: "2026-05-24T16:00:00.000Z",
          wiring_choice: "stage-3-gate",
          snippet: "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
        }),
      ),
    );
  s3Mock
    .on(GetObjectCommand, {
      Key: `${targetPrefix}CONTEXT.md`,
    })
    .resolves(
      body(`# Context

| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |
`),
    );
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
}

describe("agent uninstall-skill action", () => {
  it("removes a catalog skill from the agent workspace and refreshes agent state", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    mockCatalogUninstallS3();

    const res = await parse(
      await handler(
        event({
          action: "uninstall-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      context_md_strip: "removed",
      context_md_changed_path: "CONTEXT.md",
      deleted_paths: [
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/finance-audit-xls/WIRING.md",
      ],
    });
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/.catalog-ref.json",
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/WIRING.md",
    ]);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("uninstalls from a Space source scope without refreshing agent state", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    mockCatalogUninstallS3("tenants/acme/spaces/engineering/source/");

    const res = await parse(
      await handler(
        event({
          action: "uninstall-skill",
          spaceId: SPACE_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.context_md_strip).toBe("removed");
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/spaces/engineering/source/skills/finance-audit-xls/.catalog-ref.json",
      "tenants/acme/spaces/engineering/source/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/spaces/engineering/source/skills/finance-audit-xls/WIRING.md",
    ]);
    expect(deriveMockImpl).not.toHaveBeenCalled();
    expect(refreshAgentsMdSectionsMock).not.toHaveBeenCalled();
  });

  it("requires tenant admin before uninstalling a skill", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({
          action: "uninstall-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });
});

// ─── 4e. Catalog skill reinstall action ─────────────────────────────────────

function mockCatalogReinstallS3(
  targetPrefix = "tenants/acme/agents/marco/workspace/",
): void {
  s3Mock
    .on(GetObjectCommand, {
      Key: `${targetPrefix}skills/finance-audit-xls/.catalog-ref.json`,
    })
    .resolves(
      body(
        JSON.stringify({
          slug: "finance-audit-xls",
          source_sha256: "a".repeat(64),
          installed_at: "2026-05-24T16:00:00.000Z",
          wiring_choice: "stage-3-gate",
          snippet: "| Stage 3 gate | . | skills/finance-audit-xls/SKILL.md |\n",
        }),
      ),
    );
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: "tenants/acme/skill-catalog/finance-audit-xls/",
    })
    .resolves({
      Contents: [
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md" },
        { Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md" },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/SKILL.md",
    })
    .resolves(body("# Finance Audit v2\n"));
  s3Mock
    .on(GetObjectCommand, {
      Key: "tenants/acme/skill-catalog/finance-audit-xls/WIRING.md",
    })
    .resolves(body("## Wiring\n"));
  s3Mock
    .on(ListObjectsV2Command, {
      Prefix: `${targetPrefix}skills/finance-audit-xls/`,
    })
    .resolves({
      Contents: [
        { Key: `${targetPrefix}skills/finance-audit-xls/.catalog-ref.json` },
        { Key: `${targetPrefix}skills/finance-audit-xls/SKILL.md` },
        { Key: `${targetPrefix}skills/finance-audit-xls/old.txt` },
      ],
    });
  s3Mock
    .on(GetObjectCommand, {
      Key: `${targetPrefix}skills/finance-audit-xls/SKILL.md`,
    })
    .resolves(body("# Locally edited\n"));
  s3Mock
    .on(GetObjectCommand, {
      Key: `${targetPrefix}skills/finance-audit-xls/old.txt`,
    })
    .resolves(body("old extra file\n"));
  s3Mock.on(DeleteObjectCommand).resolves({});
  s3Mock.on(CopyObjectCommand).resolves({});
  s3Mock.on(PutObjectCommand).resolves({});
}

describe("agent reinstall-skill action", () => {
  it("refreshes a stale catalog skill in the agent workspace and refreshes agent state", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    mockCatalogReinstallS3();

    const res = await parse(
      await handler(
        event({
          action: "reinstall-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      reinstalled_paths: [
        "skills/finance-audit-xls/.catalog-ref.json",
        "skills/finance-audit-xls/SKILL.md",
        "skills/finance-audit-xls/WIRING.md",
      ],
      source_sha256: computeCatalogSkillSha([
        { relativePath: "SKILL.md", content: "# Finance Audit v2\n" },
        { relativePath: "WIRING.md", content: "## Wiring\n" },
      ]),
    });
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/old.txt",
    ]);
    expect(
      s3Mock.commandCalls(CopyObjectCommand).map((call) => call.args[0].input),
    ).toEqual([
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/SKILL.md",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/workspace/skills/finance-audit-xls/WIRING.md",
      }),
    ]);
    expect(
      s3Mock
        .commandCalls(PutObjectCommand)
        .some((call) => String(call.args[0].input.Key).endsWith("CONTEXT.md")),
    ).toBe(false);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("rejects Space skill reinstalls because capabilities belong in agent workspaces", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "reinstall-skill",
          spaceId: SPACE_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("space_capability_file_rejected");
    expect(res.body.error).toMatch(/master\/workspaces/);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(deriveMockImpl).not.toHaveBeenCalled();
    expect(refreshAgentsMdSectionsMock).not.toHaveBeenCalled();
  });

  it("surfaces reinstall worker errors with typed codes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    mockCatalogReinstallS3();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/finance-audit-xls/",
      })
      .resolves({ Contents: [] });

    const res = await parse(
      await handler(
        event({
          action: "reinstall-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe("catalog_skill_not_found");
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("requires tenant admin before reinstalling a skill", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({
          action: "reinstall-skill",
          agentId: AGENT_ID,
          slug: "finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
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

describe("computer EFS workspace target", () => {
  it("lists and reads files via the workspace-files-efs sidecar (no task queue)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    lambdaMock
      .on(InvokeCommand)
      .resolvesOnce({
        Payload: lambdaPayload({
          ok: true,
          files: [
            {
              path: "USER.md",
              source: "computer",
              sha256: "",
              overridden: false,
            },
            {
              path: "memory/contacts.md",
              source: "computer",
              sha256: "",
              overridden: false,
            },
          ],
        }) as never,
      })
      .resolvesOnce({
        Payload: lambdaPayload({
          ok: true,
          content: "Name: Eric\n",
          source: "computer",
          sha256: "",
        }) as never,
      });

    const listRes = await parse(
      await handler(event({ action: "list", computerId: COMPUTER_ID })),
    );

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.files).toEqual([
      {
        path: "memory/contacts.md",
        source: "computer",
        sha256: "",
        overridden: false,
      },
    ]);
    const listCalls = lambdaMock.commandCalls(InvokeCommand);
    expect(listCalls).toHaveLength(1);
    const listPayload = JSON.parse(
      new TextDecoder().decode(
        listCalls[0].args[0].input.Payload as Uint8Array,
      ),
    );
    expect(listPayload).toEqual({
      action: "list",
      tenantId: TENANT_A,
      computerId: COMPUTER_ID,
      includeContent: false,
    });
    expect(enqueueComputerTaskMock).not.toHaveBeenCalled();

    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);

    const getRes = await parse(
      await handler(
        event({ action: "get", computerId: COMPUTER_ID, path: "USER.md" }),
      ),
    );

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toMatchObject({
      ok: true,
      source: "computer",
      content: null,
    });
    const allCalls = lambdaMock.commandCalls(InvokeCommand);
    expect(allCalls).toHaveLength(1);
    expect(enqueueComputerTaskMock).not.toHaveBeenCalled();
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("surfaces sidecar errors as upstream-failure status codes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    lambdaMock.on(InvokeCommand).resolvesOnce({
      Payload: lambdaPayload({
        ok: false,
        status: 500,
        error: "Workspace operation failed: EFS mount lost",
      }) as never,
    });

    const res = await parse(
      await handler(event({ action: "list", computerId: COMPUTER_ID })),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      ok: false,
      error: expect.stringContaining("EFS mount lost"),
    });
  });

  it("writes and deletes files through Computer runtime tasks", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    pushDbRows([{ role: "admin" }]);
    pushDbRows([{ status: "completed", output: { ok: true }, error: null }]);

    const putRes = await parse(
      await handler(
        event({
          action: "put",
          computerId: COMPUTER_ID,
          path: "memory/notes.md",
          content: "Shared computer note\n",
        }),
      ),
    );

    expect(putRes.statusCode).toBe(200);
    expect(putRes.body).toMatchObject({ ok: true });
    expect(enqueueComputerTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: "workspace_file_write",
        taskInput: {
          path: "memory/notes.md",
          content: "Shared computer note\n",
        },
      }),
    );

    enqueueComputerTaskMock.mockResolvedValueOnce({ id: "computer-task-2" });
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    pushDbRows([{ role: "admin" }]);
    pushDbRows([{ status: "completed", output: { ok: true }, error: null }]);

    const deleteRes = await parse(
      await handler(
        event({
          action: "delete",
          computerId: COMPUTER_ID,
          path: "memory/notes.md",
        }),
      ),
    );

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body).toMatchObject({ ok: true });
    expect(enqueueComputerTaskMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskType: "workspace_file_delete",
        taskInput: { path: "memory/notes.md" },
      }),
    );
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("blocks USER.md writes and deletes from the Computer workspace", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    pushDbRows([{ role: "admin" }]);

    const putRes = await parse(
      await handler(
        event({
          action: "put",
          computerId: COMPUTER_ID,
          path: "USER.md",
          content: "Name: Eric Updated\n",
        }),
      ),
    );

    expect(putRes.statusCode).toBe(403);
    expect(putRes.body.error).toContain("USER.md is user context now");

    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    pushDbRows([{ role: "admin" }]);

    const deleteRes = await parse(
      await handler(
        event({ action: "delete", computerId: COMPUTER_ID, path: "USER.md" }),
      ),
    );

    expect(deleteRes.statusCode).toBe(403);
    expect(deleteRes.body.error).toContain("USER.md is user context now");
    expect(enqueueComputerTaskMock).not.toHaveBeenCalled();
  });
});

describe("user context workspace target", () => {
  it("lists and reads requester USER.md and memory files from the tenant/user S3 prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: `tenants/${TENANT_A}/users/${USER_ID}/USER.md` },
        { Key: `tenants/${TENANT_A}/users/${USER_ID}/knowledge-pack.md` },
        { Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/MEMORY.md` },
        { Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/DREAMS.md` },
        {
          Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/candidates/2026-05-18.md`,
        },
        {
          Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/dreaming/rem/2026-05-18.md`,
        },
        {
          Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/.dreams/2026-05-18.json`,
        },
        {
          Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/reports/thread-idle/run-1.md`,
        },
      ],
    });
    s3Mock
      .on(GetObjectCommand, {
        Bucket: "test-bucket",
        Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/MEMORY.md`,
      })
      .resolves(body("- Prefers concise summaries\n"));

    const listRes = await parse(
      await handler(event({ action: "list", userId: USER_ID })),
    );

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.files).toEqual([
      {
        path: "USER.md",
        source: "user",
        sha256: "",
        overridden: false,
      },
      {
        path: "memory/MEMORY.md",
        source: "user",
        sha256: "",
        overridden: false,
      },
      {
        path: "memory/DREAMS.md",
        source: "user",
        sha256: "",
        overridden: false,
      },
      {
        path: "memory/candidates/2026-05-18.md",
        source: "user",
        sha256: "",
        overridden: false,
      },
      {
        path: "memory/dreaming/rem/2026-05-18.md",
        source: "user",
        sha256: "",
        overridden: false,
      },
    ]);

    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    const getRes = await parse(
      await handler(
        event({
          action: "get",
          userId: USER_ID,
          path: "memory/MEMORY.md",
        }),
      ),
    );

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toMatchObject({
      ok: true,
      source: "user",
      content: "- Prefers concise summaries\n",
    });
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it("blocks hidden requester memory internals from direct User context reads", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);

    const getRes = await parse(
      await handler(
        event({
          action: "get",
          userId: USER_ID,
          path: "memory/.dreams/2026-05-18.json",
        }),
      ),
    );

    expect(getRes.statusCode).toBe(403);
    expect(getRes.body.error).toContain("User context path is not editable");
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("writes requester context files directly to the tenant/user S3 prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          userId: USER_ID,
          path: "memory/MEMORY.md",
          content: "- Prefers concise summaries\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: `tenants/${TENANT_A}/users/${USER_ID}/memory/MEMORY.md`,
      Body: "- Prefers concise summaries\n",
    });
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

  it.each(["skills/finance-audit-xls/SKILL.md", "TOOLS.md", "MCP.md"])(
    "PUT to Space capability path %s returns typed 403",
    async (path) => {
      authMockImpl.mockResolvedValue(authOk());
      queueAdminSpaceTargetRows();

      const res = await parse(
        await handler(
          event({
            action: "put",
            spaceId: SPACE_ID,
            path,
            content: "nope",
          }),
        ),
      );

      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe("space_capability_file_rejected");
      expect(res.body.error).toMatch(/master\/workspaces/);
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    },
  );

  it("allows Space knowledge and SPACE.md writes", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const knowledgeRes = await parse(
      await handler(
        event({
          action: "put",
          spaceId: SPACE_ID,
          path: "knowledge/cap-table.md",
          content: "# Cap table\n",
        }),
      ),
    );
    expect(knowledgeRes.statusCode).toBe(200);

    queueAdminSpaceTargetRows();
    const spaceMdRes = await parse(
      await handler(
        event({
          action: "put",
          spaceId: SPACE_ID,
          path: "SPACE.md",
          content: "# Engineering\n",
        }),
      ),
    );
    expect(spaceMdRes.statusCode).toBe(200);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
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

describe("Space capability-file write guard", () => {
  it("rejects moving a file into the Space skills folder before S3 mutation", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "move",
          spaceId: SPACE_ID,
          fromPath: "knowledge/notes.md",
          toFolder: "skills/finance-audit-xls",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("space_capability_file_rejected");
    expect(res.body.error).toMatch(/master\/workspaces/);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("rejects renaming a Space file to TOOLS.md before S3 mutation", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "rename",
          spaceId: SPACE_ID,
          fromPath: "knowledge/tools-notes.md",
          toPath: "TOOLS.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("space_capability_file_rejected");
    expect(res.body.error).toMatch(/master\/workspaces/);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
});

describe("agent MOVE (Unit 1: single-file)", () => {
  function adminAgentRows() {
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]); // resolveCallerFromAuth
    pushDbRows([agentRow()]); // resolveAgentTarget: agents
    pushDbRows([tenantRow()]); // resolveAgentTarget: tenants
    pushDbRows([{ role: "admin" }]); // callerIsTenantAdmin
  }

  it("moves a single file into a folder and returns dest path + counts", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    // First ListObjectsV2 call: folder-vs-file detection on source — empty.
    // Second call: destination sibling listing — empty (no collision).
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/memory/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      destPath: "memory/notes.md",
      movedCount: 1,
      detachedPinnedCount: 0,
    });
    const copies = s3Mock.commandCalls(CopyObjectCommand);
    expect(copies.length).toBe(1);
    expect(copies[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/memory/notes.md",
    );
    expect(copies[0].args[0].input.CopySource).toBe(
      "test-bucket/tenants/acme/agents/marco/workspace/notes.md",
    );
    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.length).toBe(1);
    expect(deletes[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/notes.md",
    );
  });

  it("auto-renames file on destination collision (extension preserved)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/memory/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/memory/notes.md" },
        ],
      });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "events/notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.destPath).toBe("memory/notes (2).md");
    const copies = s3Mock.commandCalls(CopyObjectCommand);
    expect(copies[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/memory/notes (2).md",
    );
  });

  it("auto-renames with the next available suffix when (2) is taken", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/memory/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/memory/notes.md" },
          { Key: "tenants/acme/agents/marco/workspace/memory/notes (2).md" },
        ],
      });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "events/notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.destPath).toBe("memory/notes (3).md");
  });

  it("moving a pinned file succeeds silently and reports detachedPinnedCount=1", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/GUARDRAILS.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "GUARDRAILS.md",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      destPath: "archive/GUARDRAILS.md",
      movedCount: 1,
      detachedPinnedCount: 1,
    });
  });

  it("returns 400 when source and destination are identical", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/notes.md/",
      })
      .resolves({ Contents: [] });

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toFolder: "",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/identical/i);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
  });

  it("rejects move with computerId target (Computer concept retired)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]); // resolveComputerTarget
    pushDbRows([{ role: "admin" }]); // U31 role gate

    const res = await parse(
      await handler(
        event({
          action: "move",
          computerId: COMPUTER_ID,
          fromPath: "notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/computer/i);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
  });

  it("returns 404 for cross-tenant agent target (no existence leakage)", async () => {
    authMockImpl.mockResolvedValue(authOk()); // tenant A
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ ...agentRow(), tenant_id: TENANT_B }]); // agent belongs to tenant B

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(404);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
  });

  it("returns 403 when caller is not a tenant admin/owner", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]); // not admin

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
  });

  it("refreshes AGENTS.md sections when moving root AGENTS.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/AGENTS.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "AGENTS.md",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("refreshes AGENTS.md sections when moving a sub-agent SKILL.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/skills/old-slug/SKILL.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/skills/new-slug/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "skills/old-slug/SKILL.md",
          toFolder: "skills/new-slug",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("does not resync agent_skills for plain-file moves", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/memory/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).toHaveBeenCalledTimes(0);
  });

  it("returns 400 when fromPath is missing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          toFolder: "memory",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/fromPath/i);
  });

  it("returns 400 when toFolder is missing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/toFolder/i);
  });
});

describe("agent MOVE (Unit 2: folder moves)", () => {
  function adminAgentRows() {
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
  }

  it("moves a folder of multiple files atomically; source disappears (no .gitkeep re-emit)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    // First ListObjectsV2 call: folder detection on source — returns
    // the relative contents of the folder.
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/events/log.md" },
          { Key: "tenants/acme/agents/marco/workspace/events/meeting.md" },
          { Key: "tenants/acme/agents/marco/workspace/events/notes.md" },
        ],
      });
    // Destination sibling listing — empty (no folder collision at "archive/").
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "events",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      destPath: "archive/events",
      movedCount: 3,
      detachedPinnedCount: 0,
    });

    const copies = s3Mock.commandCalls(CopyObjectCommand);
    expect(copies.length).toBe(3);
    expect(copies.map((c) => c.args[0].input.Key).sort()).toEqual([
      "tenants/acme/agents/marco/workspace/archive/events/log.md",
      "tenants/acme/agents/marco/workspace/archive/events/meeting.md",
      "tenants/acme/agents/marco/workspace/archive/events/notes.md",
    ]);

    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.length).toBe(3);
    expect(deletes.map((c) => c.args[0].input.Key).sort()).toEqual([
      "tenants/acme/agents/marco/workspace/events/log.md",
      "tenants/acme/agents/marco/workspace/events/meeting.md",
      "tenants/acme/agents/marco/workspace/events/notes.md",
    ]);

    // Source folder should disappear from the tree after move (Finder
    // semantics). We do NOT re-emit a .gitkeep sentinel at the source
    // prefix — the operator expects the folder to be gone.
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("moves every object including manifest.json and .gitkeep (no operational-artifact filter)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    // A folder that contains a stray nested manifest.json. The earlier
    // listPrefix-based implementation filtered these out and stranded
    // them at the source. The unfiltered walk must include + delete.
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/earnest-falcon-947/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/workspace/earnest-falcon-947/AGENTS.md",
          },
          {
            Key: "tenants/acme/agents/marco/workspace/earnest-falcon-947/CONTEXT.md",
          },
          {
            Key: "tenants/acme/agents/marco/workspace/earnest-falcon-947/manifest.json",
          },
          {
            Key: "tenants/acme/agents/marco/workspace/earnest-falcon-947/.gitkeep",
          },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/agents/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "earnest-falcon-947",
          toFolder: "agents",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      destPath: "agents/earnest-falcon-947",
      movedCount: 4,
    });

    const copies = s3Mock.commandCalls(CopyObjectCommand);
    expect(copies.map((c) => c.args[0].input.Key).sort()).toEqual([
      "tenants/acme/agents/marco/workspace/agents/earnest-falcon-947/.gitkeep",
      "tenants/acme/agents/marco/workspace/agents/earnest-falcon-947/AGENTS.md",
      "tenants/acme/agents/marco/workspace/agents/earnest-falcon-947/CONTEXT.md",
      "tenants/acme/agents/marco/workspace/agents/earnest-falcon-947/manifest.json",
    ]);

    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.map((c) => c.args[0].input.Key).sort()).toEqual([
      "tenants/acme/agents/marco/workspace/earnest-falcon-947/.gitkeep",
      "tenants/acme/agents/marco/workspace/earnest-falcon-947/AGENTS.md",
      "tenants/acme/agents/marco/workspace/earnest-falcon-947/CONTEXT.md",
      "tenants/acme/agents/marco/workspace/earnest-falcon-947/manifest.json",
    ]);

    // No .gitkeep re-emit at source — folder disappears entirely.
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("auto-renames the destination folder on collision", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/events/log.md" },
        ],
      });
    // Destination already has an `events/` folder (any child under it is enough).
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/workspace/archive/events/old.md",
          },
        ],
      });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "events",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.destPath).toBe("archive/events (2)");
    const copies = s3Mock.commandCalls(CopyObjectCommand);
    expect(copies[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/archive/events (2)/log.md",
    );
  });

  it("refreshes AGENTS.md sections when a moved folder contains AGENTS.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/sub/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/sub/AGENTS.md" },
          { Key: "tenants/acme/agents/marco/workspace/sub/CONTEXT.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "sub",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("refreshes AGENTS.md sections when many SKILL.md files move", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/skills/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/workspace/skills/a/SKILL.md",
          },
          {
            Key: "tenants/acme/agents/marco/workspace/skills/b/SKILL.md",
          },
          {
            Key: "tenants/acme/agents/marco/workspace/skills/c/SKILL.md",
          },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "skills",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("does not resync agent_skills when no moved file is AGENTS.md or SKILL.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/notes/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/notes/a.md" },
          { Key: "tenants/acme/agents/marco/workspace/notes/b.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "notes",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(deriveMockImpl).toHaveBeenCalledTimes(0);
  });

  it("rejects moving a folder into itself or a subfolder of itself with 400", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/projects/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/projects/sub/note.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/projects/sub/",
      })
      .resolves({ Contents: [] });

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "projects",
          toFolder: "projects/sub",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/itself/i);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
  });

  it("does NOT delete source objects when a copy fails mid-walk (atomicity)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/events/a.md" },
          { Key: "tenants/acme/agents/marco/workspace/events/b.md" },
          { Key: "tenants/acme/agents/marco/workspace/events/c.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });

    // First copy succeeds, second fails — third never runs.
    let copyCount = 0;
    s3Mock.on(CopyObjectCommand).callsFake(() => {
      copyCount++;
      if (copyCount === 2) {
        throw new Error("S3 copy intermittent failure");
      }
      return {};
    });

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "events",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    // No deletes should have fired since the copy phase failed.
    expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
    // No PutObject should fire on the copy-failure path.
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("returns partiallyDeleted when a delete fails mid-walk", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/events/a.md" },
          { Key: "tenants/acme/agents/marco/workspace/events/b.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});

    let deleteCount = 0;
    s3Mock.on(DeleteObjectCommand).callsFake(() => {
      deleteCount++;
      if (deleteCount === 2) {
        throw new Error("S3 delete intermittent failure");
      }
      return {};
    });

    const res = await parse(
      await handler(
        event({
          action: "move",
          agentId: AGENT_ID,
          fromPath: "events",
          toFolder: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      ok: false,
      partiallyDeleted: true,
      destPath: "archive/events",
      movedCount: 2,
    });
    // Both copies fired (full destination present).
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(2);
    // Manifest regen was skipped on the partial path; no PutObject fires.
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });
});

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

describe("agent RENAME", () => {
  function adminAgentRows() {
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
  }

  function destinationMissing() {
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    } as never);
  }

  it("renames a single file to the exact destination path", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    destinationMissing();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/ideas.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "rename",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toPath: "ideas.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      destPath: "ideas.md",
      movedCount: 1,
    });
    expect(s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/ideas.md",
    );
    expect(s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/workspace/notes.md",
    );
  });

  it("rejects an exact rename when the destination already exists", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(HeadObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/ideas.md",
      })
      .resolves({});

    const res = await parse(
      await handler(
        event({
          action: "rename",
          agentId: AGENT_ID,
          fromPath: "notes.md",
          toPath: "ideas.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
  });

  it("renames a folder by rewriting every child object", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    destinationMissing();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/events/a.md" },
          { Key: "tenants/acme/agents/marco/workspace/events/nested/b.md" },
        ],
      });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "rename",
          agentId: AGENT_ID,
          fromPath: "events",
          toPath: "archive",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      destPath: "archive",
      movedCount: 2,
    });
    expect(
      s3Mock
        .commandCalls(CopyObjectCommand)
        .map((call) => call.args[0].input.Key)
        .sort(),
    ).toEqual([
      "tenants/acme/agents/marco/workspace/archive/a.md",
      "tenants/acme/agents/marco/workspace/archive/nested/b.md",
    ]);
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key)
        .sort(),
    ).toEqual([
      "tenants/acme/agents/marco/workspace/events/a.md",
      "tenants/acme/agents/marco/workspace/events/nested/b.md",
    ]);
  });

  it("rejects renaming a folder into one of its descendants", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    destinationMissing();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/workspace/events/nested/a.md" },
        ],
      });

    const res = await parse(
      await handler(
        event({
          action: "rename",
          agentId: AGENT_ID,
          fromPath: "events",
          toPath: "events/nested",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/subfolder/i);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand).length).toBe(0);
  });

  it("refreshes AGENTS.md sections when renaming AGENTS.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    destinationMissing();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/ROUTES.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/AGENTS.md/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "rename",
          agentId: AGENT_ID,
          fromPath: "AGENTS.md",
          toPath: "ROUTES.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("rejects rename with computerId target", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([computerRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "rename",
          computerId: COMPUTER_ID,
          fromPath: "notes.md",
          toPath: "ideas.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/computer/i);
    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
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
      "tenants/acme/agents/marco/workspace/workspaces/support/CONTEXT.md",
      "tenants/acme/agents/marco/workspace/AGENTS.md",
    ]);
    expect(String(puts[1].args[0].input.Body)).toContain(
      "| support specialist | workspaces/support/ | workspaces/support/CONTEXT.md |  |",
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

  it("rejects workspaces as a reserved sub-agent slug before writing", async () => {
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
          slug: "workspaces",
          contextContent: "# Workspaces\n",
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
            Key: "tenants/acme/agents/marco/workspace/workspaces/expenses/CONTEXT.md",
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

  it("generate-folder-structure by a member-role caller → 403", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({
          action: "generate-folder-structure",
          agentId: AGENT_ID,
          path: "CONTEXT.md",
        }),
      ),
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

  it("update-identity-field rewrites the AGENTS.md identity line", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/AGENTS.md",
      })
      .resolves(
        body(
          [
            "# AGENTS.md",
            "",
            "## Identity",
            "",
            "- **Name:** Marco",
            "- **Creature:** old creature",
            "- **Vibe:** focused",
            "- **Emoji:** 🤖",
            "- **Avatar:** none",
            "",
          ].join("\n"),
        ),
      );
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "update-identity-field",
          agentId: AGENT_ID,
          field: "creature",
          value: "axolotl\nwith injection",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    const put = s3Mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(put?.Key).toBe("tenants/acme/agents/marco/workspace/AGENTS.md");
    expect(String(put?.Body)).toContain(
      "- **Creature:** axolotl with injection",
    );
  });

  it("update-identity-field rejects unknown fields before writing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "update-identity-field",
          agentId: AGENT_ID,
          field: "name",
          value: "Nova",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Unknown identity field");
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("update-identity-field rejects non-string values before writing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);

    const res = await parse(
      await handler(
        event({
          action: "update-identity-field",
          agentId: AGENT_ID,
          field: "creature",
          value: 42,
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("value must be a string");
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("update-identity-field returns 422 when AGENTS.md is missing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/AGENTS.md",
      })
      .rejects(noSuchKey());

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

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toContain("AGENTS.md is missing the Creature");
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("update-identity-field returns 422 when the requested AGENTS.md anchor is missing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/workspace/AGENTS.md",
      })
      .resolves(body("# AGENTS.md\n\n## Identity\n- **Name:** Marco\n"));

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

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toContain("AGENTS.md is missing the Creature");
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
        Key: "tenants/acme/agents/marco/workspace/AGENTS.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/exec-assistant/workspace/AGENTS.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/defaults/workspace/AGENTS.md",
      })
      .resolves(body("Your name is {{AGENT_NAME}}."));

    const res = await parse(
      await handler(
        event({ action: "get", agentId: AGENT_ID, path: "AGENTS.md" }),
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

  it("PUT on retired PLATFORM.md does NOT require acceptTemplateUpdate", async () => {
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
          path: "PLATFORM.md",
          content: "override",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
  });

  it("PUT on retired CAPABILITIES.md does NOT require acceptTemplateUpdate", async () => {
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
          path: "CAPABILITIES.md",
          content: "override",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
  });
});

// ─── 9. workspace skill marker AGENTS.md refresh wiring ─────────────────────

describe("workspace skills → AGENTS.md refresh wiring", () => {
  it("PUT on root skills/<slug>/SKILL.md refreshes AGENTS.md derived sections", async () => {
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
          path: "skills/approve-receipt/SKILL.md",
          content: "# Approve receipt\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
    expect(deriveMockImpl).toHaveBeenCalledWith(
      { tenantId: TENANT_A },
      AGENT_ID,
    );
  });

  it("PUT on a sub-agent skill marker refreshes AGENTS.md derived sections", async () => {
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
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
    expect(deriveMockImpl).toHaveBeenCalledWith(
      { tenantId: TENANT_A },
      AGENT_ID,
    );
  });

  it("PUT on CONTEXT.md refreshes AGENTS.md derived sections without deriving DB rows", async () => {
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
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
    expect(deriveMockImpl).not.toHaveBeenCalled();
  });

  it("PUT on expenses/CONTEXT.md refreshes AGENTS.md derived sections without deriving DB rows", async () => {
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
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
    expect(deriveMockImpl).not.toHaveBeenCalled();
  });

  it("AGENTS.md refresh failure → 500 with error message; S3 put already happened", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "admin" }]);
    s3Mock.on(PutObjectCommand).resolves({});
    refreshAgentsMdSectionsMock.mockRejectedValue(
      new Error("workspace map unavailable"),
    );

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
    expect(res.body.error).toMatch(/AGENTS.md section refresh failed/);
    expect(res.body.error).toMatch(/workspace map unavailable/);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
  });

  it("DELETE on a skill marker refreshes AGENTS.md derived sections", async () => {
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
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
    expect(deriveMockImpl).toHaveBeenCalledWith(
      { tenantId: TENANT_A },
      AGENT_ID,
    );
  });

  it("PUT on template skill marker does not refresh agent AGENTS.md", async () => {
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
    expect(refreshAgentsMdSectionsMock).not.toHaveBeenCalled();
  });
});
