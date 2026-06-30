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
import {
  parseCatalogSkillArchive,
  renderCatalogSkillArchive,
} from "../lib/catalog-skill-archive.js";

// ─── Hoisted DB mock ─────────────────────────────────────────────────────────

const {
  dbQueue,
  pushDbRows,
  resetDbQueue,
  eqCalls,
  resetEqCalls,
  dbUpdateCalls,
  resetDbUpdateCalls,
  dbInsertCalls,
  resetDbInsertCalls,
} = vi.hoisted(() => {
  const queue: unknown[][] = [];
  const calls: { col: unknown; value: unknown }[] = [];
  const updates: unknown[] = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];
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
    dbUpdateCalls: updates,
    resetDbUpdateCalls: () => {
      updates.length = 0;
    },
    dbInsertCalls: inserts,
    resetDbInsertCalls: () => {
      inserts.length = 0;
    },
  };
});

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
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((updates: unknown) => {
          dbUpdateCalls.push(updates);
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      })),
      insert: vi.fn().mockImplementation((table: unknown) => ({
        values: vi.fn().mockImplementation((values: unknown) => {
          dbInsertCalls.push({ table, values });
          return Promise.resolve([]);
        }),
      })),
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
      workspace_folder_name: tableCol("spaces.workspace_folder_name"),
      name: tableCol("spaces.name"),
      description: tableCol("spaces.description"),
      config: tableCol("spaces.config"),
      render_diagnostics: tableCol("spaces.render_diagnostics"),
      updated_at: tableCol("spaces.updated_at"),
    },
    skillDrafts: {
      id: tableCol("skill_drafts.id"),
      tenant_id: tableCol("skill_drafts.tenant_id"),
      requested_by_user_id: tableCol("skill_drafts.requested_by_user_id"),
      status: tableCol("skill_drafts.status"),
      draft_s3_prefix: tableCol("skill_drafts.draft_s3_prefix"),
      metadata: tableCol("skill_drafts.metadata"),
      current_content_hash: tableCol("skill_drafts.current_content_hash"),
      published_catalog_slug: tableCol("skill_drafts.published_catalog_slug"),
      published_content_hash: tableCol("skill_drafts.published_content_hash"),
      updated_at: tableCol("skill_drafts.updated_at"),
    },
    skillDraftEvents: {
      id: tableCol("skill_draft_events.id"),
      tenant_id: tableCol("skill_draft_events.tenant_id"),
      draft_id: tableCol("skill_draft_events.draft_id"),
      actor_user_id: tableCol("skill_draft_events.actor_user_id"),
      event_type: tableCol("skill_draft_events.event_type"),
      created_at: tableCol("skill_draft_events.created_at"),
    },
    skillCatalog: {
      tenant_id: tableCol("skill_catalog.tenant_id"),
      slug: tableCol("skill_catalog.slug"),
      content_sha: tableCol("skill_catalog.content_sha"),
      trust_report: tableCol("skill_catalog.trust_report"),
      trust_report_content_sha: tableCol(
        "skill_catalog.trust_report_content_sha",
      ),
      trust_report_pipeline_version: tableCol(
        "skill_catalog.trust_report_pipeline_version",
      ),
      trust_report_updated_at: tableCol(
        "skill_catalog.trust_report_updated_at",
      ),
      signature_status: tableCol("skill_catalog.signature_status"),
      signature_payload: tableCol("skill_catalog.signature_payload"),
      signed_content_sha: tableCol("skill_catalog.signed_content_sha"),
      signed_payload_hash: tableCol("skill_catalog.signed_payload_hash"),
      signed_at: tableCol("skill_catalog.signed_at"),
      signed_by_user_id: tableCol("skill_catalog.signed_by_user_id"),
      updated_at: tableCol("skill_catalog.updated_at"),
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
      workspace_folder_name: tableCol("users.workspace_folder_name"),
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

// Write-through to the skill_catalog index is unit-tested in catalog-index.test.ts;
// here we mock it to a controllable spy so we can assert the handler fires it on
// the right catalog mutations and that a failure is non-fatal (U3).
const { reindexCatalogSkillMock, listIndexedSkillsMock } = vi.hoisted(() => ({
  reindexCatalogSkillMock: vi.fn(),
  listIndexedSkillsMock: vi.fn(),
}));

vi.mock("../lib/catalog-index.js", () => ({
  reindexCatalogSkill: reindexCatalogSkillMock,
  listIndexedSkills: listIndexedSkillsMock,
}));

const { ensureSkillDatasetSeededMock, launchSkillEvalRunMock } = vi.hoisted(
  () => ({
    ensureSkillDatasetSeededMock: vi.fn(),
    launchSkillEvalRunMock: vi.fn(),
  }),
);

vi.mock("../lib/evals/skill-dataset.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/evals/skill-dataset.js")>();
  return {
    ...actual,
    ensureSkillDatasetSeeded: ensureSkillDatasetSeededMock,
  };
});

vi.mock("../lib/evals/skill-eval-run.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/evals/skill-eval-run.js")>();
  return {
    ...actual,
    launchSkillEvalRun: launchSkillEvalRunMock,
  };
});

// ─── Mock the Agent Profile projection functions (U7). Path predicates stay
// real (isGovernanceFilePath depends on them); only the DB-touching
// projection entry points are spied so the handler wiring can be asserted
// without the agent_profiles drizzle chain. Row-scoping behavior is
// unit-tested in src/lib/agent-profile-workspace-files.test.ts.
const {
  upsertAgentProfileProjectionMock,
  deleteAgentProfileProjectionMock,
  upsertSpaceAgentProfileProjectionMock,
  deleteSpaceAgentProfileProjectionMock,
} = vi.hoisted(() => ({
  upsertAgentProfileProjectionMock: vi.fn(),
  deleteAgentProfileProjectionMock: vi.fn(),
  upsertSpaceAgentProfileProjectionMock: vi.fn(),
  deleteSpaceAgentProfileProjectionMock: vi.fn(),
}));

vi.mock("../lib/agent-profile-workspace-files.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../lib/agent-profile-workspace-files.js")
    >();
  return {
    ...actual,
    upsertAgentProfileProjectionFromFile: upsertAgentProfileProjectionMock,
    deleteAgentProfileProjectionForFile: deleteAgentProfileProjectionMock,
    upsertSpaceAgentProfileProjectionFromFile:
      upsertSpaceAgentProfileProjectionMock,
    deleteSpaceAgentProfileProjectionForFile:
      deleteSpaceAgentProfileProjectionMock,
  };
});

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
const DRAFT_ID = "draft-skill-id";
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

function skillDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    tenant_id: TENANT_A,
    requested_by_user_id: USER_ID,
    status: "draft",
    draft_s3_prefix: `tenants/acme/skill-drafts/${DRAFT_ID}/`,
    metadata: {},
    ...overrides,
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    tenant_id: TENANT_A,
    email: EMAIL,
    name: "Eric Odom",
    workspaceFolderName: "eric",
    ...overrides,
  };
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

function queueOwnerSkillDraftTargetRows(
  overrides: Record<string, unknown> = {},
): void {
  pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
  pushDbRows([skillDraftRow(overrides)]);
  pushDbRows([tenantRow()]);
  pushDbRows([{ role: "member" }]);
}

function queueOperatorSkillDraftTargetRows(
  overrides: Record<string, unknown> = {},
): void {
  pushDbRows([{ id: "operator-id", tenant_id: TENANT_A }]);
  pushDbRows([
    skillDraftRow({ requested_by_user_id: "author-id", ...overrides }),
  ]);
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
      transformToByteArray: async () => new TextEncoder().encode(content),
    } as unknown as never,
  };
}

async function archiveBase64(
  slug: string,
  files: { path: string; content: Buffer }[],
): Promise<string> {
  const archive = await renderCatalogSkillArchive({ slug, files });
  return archive.bytes.toString("base64");
}

function skillMd(name: string, description = "Does useful work."): Buffer {
  return Buffer.from(`---
name: ${name}
description: ${description}
---

# ${name}
`);
}

function archiveFileText(
  files: { path: string; content: Buffer }[],
  path: string,
): string | undefined {
  return files.find((file) => file.path === path)?.content.toString("utf8");
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
  resetDbUpdateCalls();
  resetDbInsertCalls();
  authMockImpl.mockReset();
  reindexCatalogSkillMock.mockReset();
  reindexCatalogSkillMock.mockResolvedValue({ slug: "", action: "upserted" });
  listIndexedSkillsMock.mockReset();
  listIndexedSkillsMock.mockResolvedValue([]);
  ensureSkillDatasetSeededMock.mockReset();
  ensureSkillDatasetSeededMock.mockResolvedValue({
    action: "skipped",
    datasetSlug: "skill-finance-audit-xls",
    addedCaseIds: [],
    updatedCaseIds: [],
    removedCaseIds: [],
    skipped: [],
    bundledCaseCount: 0,
  });
  launchSkillEvalRunMock.mockReset();
  launchSkillEvalRunMock.mockResolvedValue({ status: "queued" });
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
  upsertAgentProfileProjectionMock.mockReset();
  upsertAgentProfileProjectionMock.mockResolvedValue({ id: "profile-row" });
  deleteAgentProfileProjectionMock.mockReset();
  deleteAgentProfileProjectionMock.mockResolvedValue(true);
  upsertSpaceAgentProfileProjectionMock.mockReset();
  upsertSpaceAgentProfileProjectionMock.mockResolvedValue({
    id: "space-profile-row",
  });
  deleteSpaceAgentProfileProjectionMock.mockReset();
  deleteSpaceAgentProfileProjectionMock.mockResolvedValue(true);
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
        Prefix: "tenants/acme/agents/marco/memory/note.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Key: "tenants/acme/agents/marco/AGENTS.md",
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
        Key: "tenants/acme/agents/marco/SOUL.md",
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
        Key: "tenants/acme/spaces/engineering/AGENTS.md",
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

describe("skill draft file target", () => {
  it("lists and reads draft files from the tenant draft prefix for the requester", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOwnerSkillDraftTargetRows();
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` },
        { Key: `tenants/acme/skill-drafts/${DRAFT_ID}/references/guide.md` },
      ],
    });

    const listRes = await parse(
      await handler(event({ action: "list", skillDraftId: DRAFT_ID })),
    );

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.files).toEqual([
      {
        path: "SKILL.md",
        source: "skillDraft",
        sha256: "",
        overridden: false,
      },
      {
        path: "references/guide.md",
        source: "skillDraft",
        sha256: "",
        overridden: false,
      },
    ]);

    queueOwnerSkillDraftTargetRows();
    s3Mock
      .on(GetObjectCommand, {
        Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md`,
      })
      .resolves(body(skillMd("draft-helper").toString("utf8")));

    const getRes = await parse(
      await handler(
        event({
          action: "get",
          skillDraftId: DRAFT_ID,
          path: "SKILL.md",
        }),
      ),
    );

    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toMatchObject({
      ok: true,
      source: "skillDraft",
    });
  });

  it("lets the requester write draft files, then updates the draft content hash and clears publish fields", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOwnerSkillDraftTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` }],
    });

    const res = await parse(
      await handler(
        event({
          action: "put",
          skillDraftId: DRAFT_ID,
          path: "SKILL.md",
          content: skillMd("draft-helper").toString("utf8"),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.slug).toBe("draft-helper");
    expect(res.body.currentContentHash).toMatch(/^sha256:/);
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md`,
    });
    expect(dbUpdateCalls.at(-1)).toMatchObject({
      current_content_hash: expect.stringMatching(/^sha256:/),
      published_catalog_slug: null,
      published_content_hash: null,
    });
  });

  it("allows tenant operators to read draft files but not edit them", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOperatorSkillDraftTargetRows();
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` }],
    });

    const listRes = await parse(
      await handler(event({ action: "list", skillDraftId: DRAFT_ID })),
    );
    expect(listRes.statusCode).toBe(200);

    queueOperatorSkillDraftTargetRows();
    const putRes = await parse(
      await handler(
        event({
          action: "put",
          skillDraftId: DRAFT_ID,
          path: "SKILL.md",
          content: skillMd("draft-helper").toString("utf8"),
        }),
      ),
    );

    expect(putRes.statusCode).toBe(403);
    expect(putRes.body.code).toBe("skill_draft_not_owned");
  });

  it("locks writes once the draft is submitted for review", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOwnerSkillDraftTargetRows({ status: "submitted" });

    const res = await parse(
      await handler(
        event({
          action: "delete",
          skillDraftId: DRAFT_ID,
          path: "SKILL.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("skill_draft_readonly");
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("rejects malformed skillDraftId values before target resolution", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);

    const res = await parse(
      await handler(event({ action: "list", skillDraftId: null })),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/skillDraftId is required/);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it("validates a complete draft directory without mutating S3", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOwnerSkillDraftTargetRows();
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md`,
      })
      .resolves(body(skillMd("draft-helper").toString("utf8")));

    const res = await parse(
      await handler(
        event({ action: "validate-skill-draft", skillDraftId: DRAFT_ID }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "draft-helper",
      generatedWiring: true,
    });
    expect(res.body.currentContentHash).toMatch(/^sha256:/);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("lets an operator run skill trust against a submitted draft", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOperatorSkillDraftTargetRows({ status: "submitted" });
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md`,
      })
      .resolves(body(skillMd("draft-helper").toString("utf8")));

    const res = await parse(
      await handler(
        event({
          action: "run-skill-trust",
          skillDraftId: DRAFT_ID,
          slug: "draft-helper",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "draft-helper",
      cached: false,
      trustReport: {
        slug: "draft-helper",
        spec: { status: "passed", name: "draft-helper" },
        scanner: { status: "not_configured" },
      },
    });
    expect(dbUpdateCalls.at(-1)).toMatchObject({
      metadata: expect.anything(),
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("serves a cached draft trust report from draft metadata", async () => {
    authMockImpl.mockResolvedValue(authOk());
    const draftContentSha = computeCatalogSkillSha([
      {
        relativePath: "SKILL.md",
        content: skillMd("draft-helper").toString("utf8"),
      },
    ]);
    queueOperatorSkillDraftTargetRows({
      status: "submitted",
      metadata: {
        skillTrust: {
          trustReportContentSha: draftContentSha,
          trustReportPipelineVersion: "thinkwork-skill-trust-v1",
          trustReportUpdatedAt: "2026-06-22T12:00:00.000Z",
          trustReport: {
            slug: "draft-helper",
            contentHash: draftContentSha,
            generatedAt: "2026-06-22T12:00:00.000Z",
            status: "review",
            summary: "Cached draft report.",
            spec: {
              status: "passed",
              name: "draft-helper",
              allowedTools: [],
              errors: [],
            },
            scanner: { status: "not_configured" },
            severityCounts: {
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              info: 0,
            },
            findings: [],
            evidence: {
              skillCard: "missing",
              evalDataset: "missing",
              benchmark: "missing",
              signature: "missing",
            },
            artifactPaths: { evals: [] },
          },
        },
      },
    });
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md`,
      })
      .resolves(body(skillMd("draft-helper").toString("utf8")));

    const res = await parse(
      await handler(
        event({
          action: "get-skill-trust",
          skillDraftId: DRAFT_ID,
          slug: "draft-helper",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "draft-helper",
      cached: true,
      stale: false,
      trustReport: { summary: "Cached draft report." },
    });
  });

  it("lets an operator generate missing trust evidence on a submitted draft", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueOperatorSkillDraftTargetRows({ status: "submitted" });
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: `tenants/acme/skill-drafts/${DRAFT_ID}/SKILL.md`,
      })
      .resolves(body(skillMd("draft-helper").toString("utf8")));
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          skillDraftId: DRAFT_ID,
          slug: "draft-helper",
          step: "skillCard",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "draft-helper",
      artifactPath: "skill-card.md",
      fixedStep: { step: "skillCard", status: "generated" },
    });
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: `tenants/acme/skill-drafts/${DRAFT_ID}/skill-card.md`,
      IfNoneMatch: "*",
    });
    expect(dbUpdateCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          current_content_hash: expect.stringMatching(/^sha256:/),
        }),
        expect.objectContaining({ metadata: expect.anything() }),
      ]),
    );
  });
});

// ─── 4c. Catalog skill install action ───────────────────────────────────────

function mockCatalogInstallS3(
  targetPrefix = "tenants/acme/agents/marco/",
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

// ─── 4d. Catalog index-backed summary read (U4) ──────────────────────────────

describe("catalog summary read (U4)", () => {
  it("serves the per-skill summary from the index in one query (no S3 reads)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    listIndexedSkillsMock.mockResolvedValueOnce([
      {
        slug: "crm-dashboard",
        display_name: "CRM Dashboard",
        description: "Account health",
        category: "sales",
        icon: null,
        tags: ["sales"],
        content_sha: "a".repeat(64),
        trust_report: {
          status: "passed",
          evidence: { skillCard: "starter_generated" },
        },
        trust_report_content_sha: "a".repeat(64),
        trust_report_pipeline_version: "thinkwork-skill-trust-v1",
        trust_report_updated_at: new Date("2026-06-22T12:00:00.000Z"),
      },
      {
        slug: "renewal-prep",
        display_name: null,
        description: null,
        category: null,
        icon: null,
        tags: null,
        content_sha: "b".repeat(64),
      },
    ]);

    const res = await parse(
      await handler(event({ action: "list", catalog: true, summary: true })),
    );

    expect(res.statusCode).toBe(200);
    expect(listIndexedSkillsMock).toHaveBeenCalledTimes(1);
    // No per-file content reads on the hot path (AE1).
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(res.body.skills).toEqual([
      {
        slug: "crm-dashboard",
        displayName: "CRM Dashboard",
        category: "sales",
        icon: null,
        tags: ["sales"],
        sha: "a".repeat(64),
        trustStatus: "passed",
        trustStale: false,
        skillCardStatus: "starter_generated",
        trustUpdatedAt: "2026-06-22T12:00:00.000Z",
      },
      {
        slug: "renewal-prep",
        displayName: null,
        category: null,
        icon: null,
        tags: null,
        sha: "b".repeat(64),
      },
    ]);
  });

  it("returns an empty summary for an empty index", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    listIndexedSkillsMock.mockResolvedValueOnce([]);

    const res = await parse(
      await handler(event({ action: "list", catalog: true, summary: true })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.skills).toEqual([]);
  });

  it("requires tenant admin for the summary read (same gate as the file list)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(event({ action: "list", catalog: true, summary: true })),
    );

    expect(res.statusCode).toBe(403);
    expect(listIndexedSkillsMock).not.toHaveBeenCalled();
  });
});

// ─── 4c. Catalog write-through to skill_catalog index (U3) ───────────────────

describe("catalog write-through (U3)", () => {
  it("re-indexes the affected slug after a catalog put", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          catalog: true,
          path: "finance-audit-xls/SKILL.md",
          content: "# Finance Audit XLS\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.indexWarning).toBeUndefined();
    expect(reindexCatalogSkillMock).toHaveBeenCalledTimes(1);
    expect(reindexCatalogSkillMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        tenantSlug: "acme",
        slug: "finance-audit-xls",
      }),
    );
  });

  it("re-indexes the affected slug after a catalog delete", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "delete",
          catalog: true,
          path: "finance-audit-xls/reference.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(reindexCatalogSkillMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "finance-audit-xls" }),
    );
  });

  it("returns ok with a non-fatal indexWarning when the reindex fails (S3 already committed)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});
    reindexCatalogSkillMock.mockRejectedValueOnce(new Error("db unavailable"));

    const res = await parse(
      await handler(
        event({
          action: "put",
          catalog: true,
          path: "finance-audit-xls/SKILL.md",
          content: "# Finance Audit XLS\n",
        }),
      ),
    );

    // The durable S3 write happened, so the response must NOT fail.
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.indexWarning).toMatch(/rebuild/i);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it("does not support move for catalog targets, so no reindex fires", async () => {
    // The dispatcher rejects move/rename for catalog targets (only
    // get/list/put/delete are allowed), so write-through is put/delete only.
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "move",
          catalog: true,
          fromPath: "finance-audit-xls/notes.md",
          toFolder: "web-search",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });

  it("does not re-index on a non-catalog (agent) put", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "notes/scratch.md",
          content: "hello",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });
});

describe("catalog import-skill-draft action", () => {
  it("imports a skill archive into a submitted draft without mutating the published catalog", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "import-skill-draft",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            {
              path: "references/guide.md",
              content: Buffer.from("# Guide\n"),
            },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "imported-skill",
      status: "submitted",
      generatedWiring: true,
    });
    expect(typeof res.body.draftId).toBe("string");
    expect(res.body.currentContentHash).toMatch(/^sha256:/);

    const draftPrefix = `tenants/acme/skill-drafts/${res.body.draftId}/`;
    const putKeys = s3Mock
      .commandCalls(PutObjectCommand)
      .map((call) => call.args[0].input.Key)
      .sort();
    expect(putKeys).toEqual([
      `${draftPrefix}SKILL.md`,
      `${draftPrefix}WIRING.md`,
      `${draftPrefix}references/guide.md`,
    ]);
    expect(putKeys.every((key) => String(key).includes("/skill-drafts/"))).toBe(
      true,
    );
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
    expect(ensureSkillDatasetSeededMock).not.toHaveBeenCalled();

    expect(dbInsertCalls).toHaveLength(2);
    expect(dbInsertCalls[0]?.values).toMatchObject({
      tenant_id: TENANT_A,
      requested_by_user_id: USER_ID,
      slug: "imported-skill",
      source_kind: "archive",
      status: "submitted",
      draft_s3_prefix: draftPrefix,
      current_content_hash: res.body.currentContentHash,
    });
    expect(dbInsertCalls[1]?.values).toMatchObject({
      tenant_id: TENANT_A,
      draft_id: res.body.draftId,
      actor_user_id: USER_ID,
      event_type: "submitted",
      message: "Skill draft imported from archive and submitted for review.",
    });
  });

  it("returns validation errors for invalid draft archives without mutating S3 or DB", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "import-skill-draft",
          catalog: true,
          archiveBase64: Buffer.from("not a zip").toString("base64"),
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_skill_archive");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(dbInsertCalls).toHaveLength(0);
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });

  it("allows same-slug draft imports because collisions are resolved at publish time", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md" },
        ],
      });
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "import-skill-draft",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      slug: "imported-skill",
      status: "submitted",
    });
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(
      s3Mock
        .commandCalls(PutObjectCommand)
        .map((call) => String(call.args[0].input.Key)),
    ).toEqual(
      expect.arrayContaining([
        `tenants/acme/skill-drafts/${res.body.draftId}/SKILL.md`,
      ]),
    );
    expect(dbInsertCalls[0]?.values).toMatchObject({
      slug: "imported-skill",
      source_kind: "archive",
      status: "submitted",
    });
  });
});

describe("catalog import-skill action", () => {
  it("imports a new skill archive into an empty catalog and generates WIRING.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            {
              path: "references/guide.md",
              content: Buffer.from("# Guide\n"),
            },
            {
              path: "assets/icon.bin",
              content: Buffer.from([0x00, 0xff, 0x7f]),
            },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "imported-skill",
      status: "created",
      generatedWiring: true,
    });
    const puts = s3Mock.commandCalls(PutObjectCommand).map((call) => ({
      key: call.args[0].input.Key,
      body: call.args[0].input.Body,
    }));
    expect(puts.map((put) => put.key).sort()).toEqual([
      "tenants/acme/skill-catalog/imported-skill/SKILL.md",
      "tenants/acme/skill-catalog/imported-skill/WIRING.md",
      "tenants/acme/skill-catalog/imported-skill/assets/icon.bin",
      "tenants/acme/skill-catalog/imported-skill/references/guide.md",
    ]);
    expect(
      String(puts.find((put) => put.key?.endsWith("WIRING.md"))?.body),
    ).toContain("skills/imported-skill/SKILL.md");
    expect(
      Buffer.isBuffer(
        puts.find((put) => put.key?.endsWith("assets/icon.bin"))?.body,
      ),
    ).toBe(true);
    expect(reindexCatalogSkillMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "imported-skill", tenantSlug: "acme" }),
    );
  });

  it("returns validation errors for invalid archives without mutating S3", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          archiveBase64: Buffer.from("not a zip").toString("base64"),
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_skill_archive");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });

  it("returns 409 for existing catalog slugs until replacement is confirmed", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md" },
        ],
      });

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: "skill_exists",
      slug: "imported-skill",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("returns 409 when a concurrent unconfirmed create wins the S3 conditional write", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).callsFake(() => {
      const err = new Error("already exists");
      err.name = "PreconditionFailed";
      throw err;
    });

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      code: "skill_exists",
      slug: "imported-skill",
    });
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
    expect(ensureSkillDatasetSeededMock).not.toHaveBeenCalled();
  });

  it("replaces an existing catalog skill when confirmed without touching installed copies", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md" },
          { Key: "tenants/acme/skill-catalog/imported-skill/WIRING.md" },
        ],
      });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md",
      })
      .resolves(body("old skill"));
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/WIRING.md",
      })
      .resolves(body("old wiring"));
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          confirmReplace: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            {
              path: "WIRING.md",
              content: Buffer.from("# Wiring suggestions\n"),
            },
            {
              path: "references/new.md",
              content: Buffer.from("new reference"),
            },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "imported-skill",
      status: "updated",
      generatedWiring: false,
    });
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toEqual([
      "tenants/acme/skill-catalog/imported-skill/SKILL.md",
      "tenants/acme/skill-catalog/imported-skill/WIRING.md",
    ]);
    expect(
      s3Mock
        .commandCalls(PutObjectCommand)
        .map((call) => String(call.args[0].input.Key)),
    ).not.toContain("tenants/acme/agents/marco/skills/imported-skill/SKILL.md");
    expect(reindexCatalogSkillMock).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "imported-skill" }),
    );
  });

  it("restores previous catalog objects when a confirmed replacement write fails", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md" },
          { Key: "tenants/acme/skill-catalog/imported-skill/WIRING.md" },
        ],
      });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md",
      })
      .resolves(body("old skill"));
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/WIRING.md",
      })
      .resolves(body("old wiring"));
    s3Mock.on(DeleteObjectCommand).resolves({});
    let failedSentinelWrite = false;
    s3Mock.on(PutObjectCommand).callsFake((input) => {
      if (!failedSentinelWrite && String(input.Key).endsWith("zz-fail.txt")) {
        failedSentinelWrite = true;
        throw new Error("s3 write failed");
      }
      return {};
    });

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          confirmReplace: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            {
              path: "WIRING.md",
              content: Buffer.from("# Wiring suggestions\n"),
            },
            {
              path: "references/new.md",
              content: Buffer.from("new reference"),
            },
            { path: "zz-fail.txt", content: Buffer.from("fail") },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe("catalog_skill_import_failed");
    expect(
      s3Mock.commandCalls(PutObjectCommand).map((call) => ({
        key: call.args[0].input.Key,
        body: String(call.args[0].input.Body),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          key: "tenants/acme/skill-catalog/imported-skill/SKILL.md",
          body: "old skill",
        },
        {
          key: "tenants/acme/skill-catalog/imported-skill/WIRING.md",
          body: "old wiring",
        },
      ]),
    );
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key),
    ).toContain("tenants/acme/skill-catalog/imported-skill/references/new.md");
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });

  it("reports rollback failure precisely and skips reindex/eval sync", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md" },
        ],
      });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md",
      })
      .resolves(body("old skill"));
    s3Mock.on(DeleteObjectCommand).resolves({});
    let failedNewWiringWrite = false;
    s3Mock.on(PutObjectCommand).callsFake((input) => {
      if (
        !failedNewWiringWrite &&
        String(input.Key).endsWith("WIRING.md") &&
        String(input.Body).includes("# Wiring suggestions")
      ) {
        failedNewWiringWrite = true;
        throw new Error("s3 write failed");
      }
      if (String(input.Body) === "old skill") {
        throw new Error("rollback restore failed");
      }
      return {};
    });

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          confirmReplace: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            {
              path: "WIRING.md",
              content: Buffer.from("# Wiring suggestions\n"),
            },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe("catalog_skill_import_rollback_failed");
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
    expect(ensureSkillDatasetSeededMock).not.toHaveBeenCalled();
  });

  it("syncs bundled eval cases without blocking catalog success", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    ensureSkillDatasetSeededMock.mockResolvedValueOnce({
      action: "seeded",
      datasetSlug: "skill-imported-skill",
      addedCaseIds: ["asks-first"],
      updatedCaseIds: [],
      removedCaseIds: [],
      skipped: [],
      bundledCaseCount: 1,
    });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});

    const evalCase = JSON.stringify({ query: "Ask first", rubric: "Good" });
    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            { path: "evals/asks-first.json", content: Buffer.from(evalCase) },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.evalDataset).toEqual({
      slug: "skill-imported-skill",
      cases: 1,
      skipped: 0,
    });
    expect(res.body.evalRun).toEqual({ status: "queued" });
    expect(ensureSkillDatasetSeededMock).toHaveBeenCalledWith(
      TENANT_A,
      "imported-skill",
      [{ fileName: "asks-first.json", content: evalCase }],
    );
    expect(launchSkillEvalRunMock).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      skillSlug: "imported-skill",
    });
  });

  it("surfaces reindex and eval sync warnings without failing durable import", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    reindexCatalogSkillMock.mockRejectedValueOnce(new Error("db unavailable"));
    ensureSkillDatasetSeededMock.mockRejectedValueOnce(new Error("eval down"));
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
            {
              path: "evals/asks-first.json",
              content: Buffer.from(
                JSON.stringify({ query: "Ask first", rubric: "Good" }),
              ),
            },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.indexWarning).toMatch(/rebuild/i);
    expect(res.body.evalDatasetWarning).toMatch(/eval dataset sync failed/i);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBeGreaterThan(0);
    expect(launchSkillEvalRunMock).not.toHaveBeenCalled();
  });

  it("reconciles bundled evals with an empty list when an update removes eval files", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/imported-skill/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md" },
          {
            Key: "tenants/acme/skill-catalog/imported-skill/evals/old.json",
          },
        ],
      });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/SKILL.md",
      })
      .resolves(body("old skill"));
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/skill-catalog/imported-skill/evals/old.json",
      })
      .resolves(body(JSON.stringify({ query: "Old", rubric: "Old" })));
    s3Mock.on(DeleteObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "import-skill",
          catalog: true,
          confirmReplace: true,
          archiveBase64: await archiveBase64("imported-skill", [
            { path: "SKILL.md", content: skillMd("imported-skill") },
          ]),
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(ensureSkillDatasetSeededMock).toHaveBeenCalledWith(
      TENANT_A,
      "imported-skill",
      [],
    );
  });
});

describe("catalog export-skill action", () => {
  it("exports a catalog skill as an import-compatible single-skill ZIP", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/pdf-processing/";
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: prefix,
      })
      .resolves({
        Contents: [
          { Key: `${prefix}SKILL.md` },
          { Key: `${prefix}WIRING.md` },
          { Key: `${prefix}references/guide.md` },
          { Key: `${prefix}assets/icon.bin` },
        ],
      });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skillMd("pdf-processing").toString("utf8")));
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}WIRING.md` })
      .resolves(body("# Wiring suggestions\n"));
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}references/guide.md` })
      .resolves(body("# Guide\n"));
    s3Mock.on(GetObjectCommand, { Key: `${prefix}assets/icon.bin` }).resolves({
      Body: {
        transformToByteArray: async () => Uint8Array.from([0x00, 0xff, 0x7f]),
      } as never,
      ContentType: "application/octet-stream",
    });

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "pdf-processing",
      filename: "pdf-processing.zip",
      contentType: "application/zip",
    });
    expect(typeof res.body.archiveBase64).toBe("string");
    const parsed = await parseCatalogSkillArchive(
      Buffer.from(res.body.archiveBase64, "base64"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected exported archive to parse");
    expect(parsed.slug).toBe("pdf-processing");
    expect(parsed.generatedWiring).toBe(false);
    expect(parsed.files.map((file) => file.path).sort()).toEqual([
      "SKILL.md",
      "WIRING.md",
      "assets/icon.bin",
      "references/guide.md",
    ]);
    expect(archiveFileText(parsed.files, "SKILL.md")).toBe(
      skillMd("pdf-processing").toString("utf8"),
    );
    expect(archiveFileText(parsed.files, "WIRING.md")).toBe(
      "# Wiring suggestions\n",
    );
    expect(archiveFileText(parsed.files, "references/guide.md")).toBe(
      "# Guide\n",
    );
    expect(
      parsed.files
        .find((file) => file.path === "assets/icon.bin")
        ?.content.equals(Buffer.from([0x00, 0xff, 0x7f])),
    ).toBe(true);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("runs a read-only trust report for a catalog skill", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/account-health-review/";
    const skill = `---
name: account-health-review
description: Reviews account health signals and produces a health report.
allowed-tools:
  - crm_account_summary
---

# Account Health Review
`;
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: prefix,
      })
      .resolves({
        Contents: [
          { Key: `${prefix}SKILL.md` },
          { Key: `${prefix}skill-card.md` },
          { Key: `${prefix}evals/evals.json` },
          { Key: `${prefix}BENCHMARK.md` },
        ],
      });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skill));
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}skill-card.md` })
      .resolves(body("# Skill card\n"));
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}evals/evals.json` })
      .resolves(body("[]"));
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}BENCHMARK.md` })
      .resolves(body("# Benchmark\n"));

    const res = await parse(
      await handler(
        event({
          action: "run-skill-trust",
          catalog: true,
          slug: "account-health-review",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.trustReport).toMatchObject({
      slug: "account-health-review",
      status: "review",
      spec: {
        status: "passed",
        name: "account-health-review",
        allowedTools: ["crm_account_summary"],
      },
      scanner: { status: "not_configured" },
      evidence: {
        skillCard: "present",
        evalDataset: "present",
        benchmark: "present",
        signature: "missing",
      },
    });
    expect(res.body.trustReport.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dbUpdateCalls.at(-1)).toMatchObject({
      trust_report_content_sha: expect.stringMatching(/^[a-f0-9]{64}$/),
      trust_report_pipeline_version: "thinkwork-skill-trust-v1",
      signature_status: "missing",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });

  it("returns a cached stale trust report without rerunning SkillSpector", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    pushDbRows([
      {
        contentSha: "new-catalog-sha",
        trustReportContentSha: "old-catalog-sha",
        trustReportPipelineVersion: "thinkwork-skill-trust-v1",
        trustReportUpdatedAt: new Date("2026-06-22T12:00:00.000Z"),
        trustReport: {
          slug: "account-health-review",
          contentHash: "a".repeat(64),
          generatedAt: "2026-06-21T00:00:00.000Z",
          status: "passed",
          summary: "Cached report.",
          spec: {
            status: "passed",
            allowedTools: [],
            errors: [],
          },
          scanner: { status: "completed" },
          severityCounts: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
          },
          findings: [],
          evidence: {
            skillCard: "present",
            evalDataset: "present",
            benchmark: "present",
            signature: "missing",
          },
          artifactPaths: { evals: [] },
        },
      },
    ]);

    const res = await parse(
      await handler(
        event({
          action: "get-skill-trust",
          catalog: true,
          slug: "account-health-review",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      cached: true,
      stale: true,
      currentContentSha: "new-catalog-sha",
      trustReportContentSha: "old-catalog-sha",
      trustReport: {
        summary: "Cached report.",
      },
    });
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
  });

  it("generates missing skill card evidence for a catalog skill", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/account-health-review/";
    const skill = `---
name: account-health-review
display_name: "Account Health Review"
description: Reviews account health signals and produces a health report.
allowed-tools:
  - crm_account_summary
---

# Account Health Review
`;
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: `${prefix}SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skill));

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          catalog: true,
          slug: "account-health-review",
          step: "skillCard",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      slug: "account-health-review",
      fixedStep: {
        step: "skillCard",
        status: "generated",
      },
      artifactPath: "skill-card.md",
      trustReport: {
        evidence: {
          skillCard: "starter_generated",
          evalDataset: "missing",
          benchmark: "missing",
          signature: "missing",
        },
      },
    });
    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: `${prefix}skill-card.md`,
      ContentType: "text/markdown; charset=utf-8",
      IfNoneMatch: "*",
    });
    expect(String(putCalls[0].args[0].input.Body)).toContain(
      "Generated by ThinkWork",
    );
    expect(reindexCatalogSkillMock).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      tenantSlug: "acme",
      slug: "account-health-review",
      client: expect.any(S3Client),
      bucket: "test-bucket",
    });
  });

  it("rejects catalog evidence fixes for non-admin callers", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([tenantRow()]);
    pushDbRows([{ role: "member" }]);

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          catalog: true,
          slug: "account-health-review",
          step: "skillCard",
        }),
      ),
    );

    expect(res.statusCode).toBe(403);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });

  it("fails loudly when fixing evidence for a skill without SKILL.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/account-health-review/";
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: `${prefix}README.md` }],
    });

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          catalog: true,
          slug: "account-health-review",
          step: "skillCard",
        }),
      ),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      ok: false,
      code: "skill_md_not_found",
      slug: "account-health-review",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("writes unverified signature evidence when signing config is missing", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/account-health-review/";
    const skill = `---
name: account-health-review
description: Reviews account health signals and produces a health report.
---

# Account Health Review
`;
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: `${prefix}SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skill));
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          catalog: true,
          slug: "account-health-review",
          step: "signature",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      fixedStep: {
        step: "signature",
        status: "generated",
      },
      artifactPath: "skill.oms.sig",
      trustReport: {
        evidence: {
          signature: "present_unverified",
        },
      },
    });
    expect(res.body.signedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: `${prefix}skill.oms.sig`,
      ContentType: "application/json",
    });
    expect(String(putCalls[0].args[0].input.Body)).toContain(
      '"algorithm": "UNSIGNED-APPROVAL"',
    );
    expect(reindexCatalogSkillMock).toHaveBeenCalled();
  });

  it("overwrites an existing signature when approving the current catalog snapshot", async () => {
    const previousSecret = process.env.SKILL_TRUST_SIGNING_SECRET;
    process.env.SKILL_TRUST_SIGNING_SECRET = "test-signing-secret";
    try {
      authMockImpl.mockResolvedValue(authOk());
      queueAdminCatalogTargetRows();
      const prefix = "tenants/acme/skill-catalog/account-health-review/";
      const skill = `---
name: account-health-review
description: Reviews account health signals and produces a health report.
---

# Account Health Review
`;
      s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
        Contents: [
          { Key: `${prefix}SKILL.md` },
          { Key: `${prefix}skill.oms.sig` },
        ],
      });
      s3Mock
        .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
        .resolves(body(skill));
      s3Mock
        .on(GetObjectCommand, { Key: `${prefix}skill.oms.sig` })
        .resolves(body("old-signature"));
      s3Mock.on(PutObjectCommand).resolves({});

      const res = await parse(
        await handler(
          event({
            action: "fix-skill-trust-evidence",
            catalog: true,
            slug: "account-health-review",
            step: "signature",
          }),
        ),
      );

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        fixedStep: {
          step: "signature",
          status: "generated",
        },
        artifactPath: "skill.oms.sig",
        trustReport: {
          evidence: {
            signature: "verified",
          },
        },
      });
      expect(res.body.signedPayloadHash).toMatch(/^[a-f0-9]{64}$/);
      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0].args[0].input).toMatchObject({
        Bucket: "test-bucket",
        Key: `${prefix}skill.oms.sig`,
        ContentType: "application/octet-stream",
      });
      expect(putCalls[0].args[0].input.IfNoneMatch).toBeUndefined();
      expect(String(putCalls[0].args[0].input.Body)).not.toBe("old-signature");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SKILL_TRUST_SIGNING_SECRET;
      } else {
        process.env.SKILL_TRUST_SIGNING_SECRET = previousSecret;
      }
    }
  });

  it("returns the existing artifact report if an evidence write races", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/account-health-review/";
    const skill = `---
name: account-health-review
description: Reviews account health signals and produces a health report.
---

# Account Health Review
`;
    const race = new Error("PreconditionFailed");
    race.name = "PreconditionFailed";
    s3Mock
      .on(ListObjectsV2Command, { Prefix: prefix })
      .resolvesOnce({
        Contents: [{ Key: `${prefix}SKILL.md` }],
      })
      .resolves({
        Contents: [
          { Key: `${prefix}SKILL.md` },
          { Key: `${prefix}skill-card.md` },
        ],
      });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skill));
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}skill-card.md` })
      .resolves(body("# Skill card\n"));
    s3Mock
      .on(PutObjectCommand, { Key: `${prefix}skill-card.md` })
      .rejectsOnce(race);

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          catalog: true,
          slug: "account-health-review",
          step: "skillCard",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      fixedStep: {
        step: "skillCard",
        status: "existing_artifact",
      },
      artifactPath: "skill-card.md",
      trustReport: {
        evidence: {
          skillCard: "present",
        },
      },
    });
    expect(reindexCatalogSkillMock).not.toHaveBeenCalled();
  });

  it("returns a non-fatal warning when evidence reindexing fails", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    reindexCatalogSkillMock.mockRejectedValueOnce(new Error("db unavailable"));
    const prefix = "tenants/acme/skill-catalog/account-health-review/";
    const skill = `---
name: account-health-review
description: Reviews account health signals and produces a health report.
---

# Account Health Review
`;
    s3Mock.on(ListObjectsV2Command, { Prefix: prefix }).resolves({
      Contents: [{ Key: `${prefix}SKILL.md` }],
    });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skill));

    const res = await parse(
      await handler(
        event({
          action: "fix-skill-trust-evidence",
          catalog: true,
          slug: "account-health-review",
          step: "benchmark",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.indexWarning).toContain("Skill catalog index not updated");
    expect(res.body).toMatchObject({
      fixedStep: {
        step: "benchmark",
        status: "generated",
      },
      artifactPath: "BENCHMARK.md",
    });
  });

  it("rejects export-skill for non-catalog targets without reading S3", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          agentId: AGENT_ID,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("unsupported_target");
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it.each([
    ["missing slug", undefined],
    ["legacy non-portable slug", "legacy--skill"],
  ])("returns 400 for %s", async (_name, slug) => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          ...(slug ? { slug } : {}),
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("invalid_skill_slug");
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(0);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("returns 404 when the catalog skill prefix is empty", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/skill-catalog/pdf-processing/",
      })
      .resolves({ Contents: [] });

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      ok: false,
      code: "skill_not_found",
      slug: "pdf-processing",
    });
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("returns 404 when the catalog prefix is missing SKILL.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/pdf-processing/";
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: prefix,
      })
      .resolves({
        Contents: [{ Key: `${prefix}references/guide.md` }],
      });

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({
      ok: false,
      code: "skill_md_not_found",
      slug: "pdf-processing",
    });
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("returns 422 when catalog files are not import-compatible", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/pdf-processing/";
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: prefix,
      })
      .resolves({
        Contents: [{ Key: `${prefix}SKILL.md` }],
      });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skillMd("other-skill").toString("utf8")));

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      ok: false,
      code: "invalid_catalog_skill_archive",
      slug: "pdf-processing",
    });
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "skill_name_mismatch" }),
      ]),
    );
  });

  it("returns 413 before reads when the catalog skill has too many files", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/pdf-processing/";
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: prefix,
      })
      .resolves({
        Contents: [
          { Key: `${prefix}SKILL.md` },
          ...Array.from({ length: 500 }, (_, index) => ({
            Key: `${prefix}references/${index}.md`,
          })),
        ],
      });

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({
      ok: false,
      code: "export_limit_exceeded",
      slug: "pdf-processing",
    });
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("returns 413 when catalog skill bytes exceed export response limits", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminCatalogTargetRows();
    const prefix = "tenants/acme/skill-catalog/pdf-processing/";
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: prefix,
      })
      .resolves({
        Contents: [
          { Key: `${prefix}SKILL.md` },
          { Key: `${prefix}assets/large.bin` },
        ],
      });
    s3Mock
      .on(GetObjectCommand, { Key: `${prefix}SKILL.md` })
      .resolves(body(skillMd("pdf-processing").toString("utf8")));
    s3Mock.on(GetObjectCommand, { Key: `${prefix}assets/large.bin` }).resolves({
      Body: {
        transformToByteArray: async () => new Uint8Array(4 * 1024 * 1024 + 1),
      } as never,
      ContentType: "application/octet-stream",
    });

    const res = await parse(
      await handler(
        event({
          action: "export-skill",
          catalog: true,
          slug: "pdf-processing",
        }),
      ),
    );

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({
      ok: false,
      code: "export_limit_exceeded",
      slug: "pdf-processing",
    });
  });
});

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
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
      }),
    ]);
    const contextPut = s3Mock
      .commandCalls(PutObjectCommand)
      .find(
        (call) =>
          call.args[0].input.Key === "tenants/acme/agents/marco/CONTEXT.md",
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
  targetPrefix = "tenants/acme/agents/marco/",
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
      "tenants/acme/agents/marco/skills/finance-audit-xls/.catalog-ref.json",
      "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
    ]);
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("uninstalls from a Space source scope without refreshing agent state", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    mockCatalogUninstallS3("tenants/acme/spaces/engineering/");

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
      "tenants/acme/spaces/engineering/skills/finance-audit-xls/.catalog-ref.json",
      "tenants/acme/spaces/engineering/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/spaces/engineering/skills/finance-audit-xls/WIRING.md",
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
  targetPrefix = "tenants/acme/agents/marco/",
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
      "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      "tenants/acme/agents/marco/skills/finance-audit-xls/old.txt",
    ]);
    expect(
      s3Mock.commandCalls(CopyObjectCommand).map((call) => call.args[0].input),
    ).toEqual([
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/SKILL.md",
      }),
      expect.objectContaining({
        Key: "tenants/acme/agents/marco/skills/finance-audit-xls/WIRING.md",
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
        Key: "tenants/acme/agents/marco/IDENTITY.md",
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
        { Key: "tenants/acme/agents/marco/SOUL.md" },
        {
          Key: "tenants/acme/agents/marco/skills/web-search/SKILL.md",
        },
        {
          Key: "tenants/acme/agents/marco/skills/workspace-memory/SKILL.md",
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

  it("LIST omits legacy agent workspace/ objects and workspace archives", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([agentRow()]);
    pushDbRows([tenantRow()]);

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/agents/marco/workspace/AGENTS.md" },
        { Key: "tenants/acme/agents/marco/workspace/skills/report/SKILL.md" },
        {
          Key: "tenants/acme/agents/marco/workspace-archives/blueprint/AGENTS.md",
        },
      ],
    });

    const res = await parse(
      await handler(event({ action: "list", agentId: AGENT_ID })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.files.map((f: { path: string }) => f.path)).toEqual([]);
  });
});

describe("space workspace GET / LIST", () => {
  it("LIST omits legacy source/ objects from the Space workspace root", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([spaceRowTenantA()]);
    pushDbRows([tenantRow()]);

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/spaces/engineering/source/artifacts/brief.md" },
        { Key: "tenants/acme/spaces/engineering/source/docs/customer.md" },
        { Key: "tenants/acme/spaces/engineering/SPACE.md" },
      ],
    });

    const res = await parse(
      await handler(event({ action: "list", spaceId: SPACE_ID })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.files.map((f: { path: string }) => f.path)).toEqual([
      "SPACE.md",
    ]);
  });
});

describe("user context workspace target", () => {
  it("lists and reads requester USER.md and memory files from the tenant/user S3 prefix", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    pushDbRows([tenantRow()]);
    pushDbRows([userRow()]);
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/acme/users/eric/USER.md" },
        { Key: "tenants/acme/users/eric/knowledge-pack.md" },
        { Key: "tenants/acme/users/eric/memory/MEMORY.md" },
        { Key: "tenants/acme/users/eric/memory/DREAMS.md" },
        {
          Key: "tenants/acme/users/eric/memory/candidates/2026-05-18.md",
        },
        {
          Key: "tenants/acme/users/eric/memory/dreaming/rem/2026-05-18.md",
        },
        {
          Key: "tenants/acme/users/eric/memory/.dreams/2026-05-18.json",
        },
        {
          Key: "tenants/acme/users/eric/memory/reports/thread-idle/run-1.md",
        },
      ],
    });
    s3Mock
      .on(GetObjectCommand, {
        Bucket: "test-bucket",
        Key: "tenants/acme/users/eric/memory/MEMORY.md",
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
    pushDbRows([tenantRow()]);
    pushDbRows([userRow()]);
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

  it("does not list legacy id-keyed USER.md objects through the logical User workspace", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    pushDbRows([tenantRow()]);
    pushDbRows([userRow()]);
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "tenants/tenant-a-id/users/user-eric-id/USER.md" }],
    });

    const res = await parse(
      await handler(event({ action: "list", userId: USER_ID })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it("does not read legacy id-keyed USER.md objects when the canonical slugged key is absent", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    pushDbRows([tenantRow()]);
    pushDbRows([userRow()]);
    s3Mock.on(GetObjectCommand).rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Bucket: "test-bucket",
        Key: "tenants/tenant-a-id/users/user-eric-id/USER.md",
      })
      .resolves(body("# USER.md\nEric"));

    const res = await parse(
      await handler(event({ action: "get", userId: USER_ID, path: "USER.md" })),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      source: "user",
      content: null,
    });
  });

  it("blocks hidden requester memory internals from direct User context reads", async () => {
    authMockImpl.mockResolvedValue(authOk());
    pushDbRows([{ id: USER_ID, tenant_id: TENANT_A }]);
    pushDbRows([{ principalId: USER_ID, principalType: "USER" }]);
    pushDbRows([tenantRow()]);
    pushDbRows([userRow()]);

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
    pushDbRows([tenantRow()]);
    pushDbRows([userRow()]);
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
      Key: "tenants/acme/users/eric/memory/MEMORY.md",
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
      "tenants/acme/agents/marco/expenses/GUARDRAILS.md",
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

  it("PUT on AGENTS.md writes the agent S3 workspace object and audits governance edit", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const content = "# AGENTS.md\n\nRead route/path `User/USER.md`.\n";
    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "AGENTS.md",
          content,
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: "tenants/acme/agents/marco/AGENTS.md",
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    });
    expect(emitMockImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        eventType: "workspace.governance_file_edited",
        resourceId: "acme/marco/AGENTS.md",
        action: "edit",
        outcome: "success",
      }),
    );
    expect(refreshAgentsMdSectionsMock).toHaveBeenCalledWith(AGENT_ID);
  });

  it("strips generated routing sections from AGENTS.md baseline puts", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    // An operator pasting a rendered AGENTS.md back into settings must not
    // persist the marker-delimited generated section (plan 2026-06-12-002 U2).
    const baseline = "# AGENTS.md\n\nOperator routing prose.\n";
    const pasted = `${baseline}\n<!-- RENDERED:WORKSPACE_ROUTING -->\n\n## Workspace Routing\n\n- Board Pack — \`Spaces/board-pack/\` (active, hydrated)\n`;
    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "AGENTS.md",
          content: pasted,
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Key: "tenants/acme/agents/marco/AGENTS.md",
      Body: baseline,
    });
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

  it("allows Space knowledge writes and refreshes SPACE.md projections", async () => {
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
          content: `---
name: Customer Onboarding
description: Coordinates enterprise onboarding work.
workflows: [handoff]
tools:
  built_in: [web-search]
skills: [finance-audit-xls]
---
# Customer Onboarding
`,
        }),
      ),
    );
    expect(spaceMdRes.statusCode).toBe(200);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
    expect(dbUpdateCalls).toHaveLength(1);
    expect(dbUpdateCalls[0]).toEqual(
      expect.objectContaining({
        name: "Customer Onboarding",
        description: "Coordinates enterprise onboarding work.",
      }),
    );
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
        Prefix: "tenants/acme/agents/marco/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/memory/",
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
      "tenants/acme/agents/marco/memory/notes.md",
    );
    expect(copies[0].args[0].input.CopySource).toBe(
      "test-bucket/tenants/acme/agents/marco/notes.md",
    );
    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.length).toBe(1);
    expect(deletes[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/notes.md",
    );
  });

  it("auto-renames file on destination collision (extension preserved)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/events/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/memory/",
      })
      .resolves({
        Contents: [{ Key: "tenants/acme/agents/marco/memory/notes.md" }],
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
      "tenants/acme/agents/marco/memory/notes (2).md",
    );
  });

  it("auto-renames with the next available suffix when (2) is taken", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/events/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/memory/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/memory/notes.md" },
          { Key: "tenants/acme/agents/marco/memory/notes (2).md" },
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
        Prefix: "tenants/acme/agents/marco/GUARDRAILS.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Prefix: "tenants/acme/agents/marco/notes.md/",
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
        Prefix: "tenants/acme/agents/marco/AGENTS.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Prefix: "tenants/acme/agents/marco/skills/old-slug/SKILL.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/skills/new-slug/",
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
        Prefix: "tenants/acme/agents/marco/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/memory/",
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
        Prefix: "tenants/acme/agents/marco/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/events/log.md" },
          { Key: "tenants/acme/agents/marco/events/meeting.md" },
          { Key: "tenants/acme/agents/marco/events/notes.md" },
        ],
      });
    // Destination sibling listing — empty (no folder collision at "archive/").
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
      "tenants/acme/agents/marco/archive/events/log.md",
      "tenants/acme/agents/marco/archive/events/meeting.md",
      "tenants/acme/agents/marco/archive/events/notes.md",
    ]);

    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.length).toBe(3);
    expect(deletes.map((c) => c.args[0].input.Key).sort()).toEqual([
      "tenants/acme/agents/marco/events/log.md",
      "tenants/acme/agents/marco/events/meeting.md",
      "tenants/acme/agents/marco/events/notes.md",
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
        Prefix: "tenants/acme/agents/marco/earnest-falcon-947/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/earnest-falcon-947/AGENTS.md",
          },
          {
            Key: "tenants/acme/agents/marco/earnest-falcon-947/CONTEXT.md",
          },
          {
            Key: "tenants/acme/agents/marco/earnest-falcon-947/manifest.json",
          },
          {
            Key: "tenants/acme/agents/marco/earnest-falcon-947/.gitkeep",
          },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/agents/",
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
      "tenants/acme/agents/marco/agents/earnest-falcon-947/.gitkeep",
      "tenants/acme/agents/marco/agents/earnest-falcon-947/AGENTS.md",
      "tenants/acme/agents/marco/agents/earnest-falcon-947/CONTEXT.md",
      "tenants/acme/agents/marco/agents/earnest-falcon-947/manifest.json",
    ]);

    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.map((c) => c.args[0].input.Key).sort()).toEqual([
      "tenants/acme/agents/marco/earnest-falcon-947/.gitkeep",
      "tenants/acme/agents/marco/earnest-falcon-947/AGENTS.md",
      "tenants/acme/agents/marco/earnest-falcon-947/CONTEXT.md",
      "tenants/acme/agents/marco/earnest-falcon-947/manifest.json",
    ]);

    // No .gitkeep re-emit at source — folder disappears entirely.
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("auto-renames the destination folder on collision", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/events/",
      })
      .resolves({
        Contents: [{ Key: "tenants/acme/agents/marco/events/log.md" }],
      });
    // Destination already has an `events/` folder (any child under it is enough).
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/archive/events/old.md",
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
      "tenants/acme/agents/marco/archive/events (2)/log.md",
    );
  });

  it("refreshes AGENTS.md sections when a moved folder contains AGENTS.md", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/sub/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/sub/AGENTS.md" },
          { Key: "tenants/acme/agents/marco/sub/CONTEXT.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Prefix: "tenants/acme/agents/marco/skills/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/skills/a/SKILL.md",
          },
          {
            Key: "tenants/acme/agents/marco/skills/b/SKILL.md",
          },
          {
            Key: "tenants/acme/agents/marco/skills/c/SKILL.md",
          },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Prefix: "tenants/acme/agents/marco/notes/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/notes/a.md" },
          { Key: "tenants/acme/agents/marco/notes/b.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Prefix: "tenants/acme/agents/marco/projects/",
      })
      .resolves({
        Contents: [{ Key: "tenants/acme/agents/marco/projects/sub/note.md" }],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/projects/sub/",
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
        Prefix: "tenants/acme/agents/marco/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/events/a.md" },
          { Key: "tenants/acme/agents/marco/events/b.md" },
          { Key: "tenants/acme/agents/marco/events/c.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
        Prefix: "tenants/acme/agents/marco/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/events/a.md" },
          { Key: "tenants/acme/agents/marco/events/b.md" },
        ],
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/archive/",
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
      "tenants/acme/agents/marco/IDENTITY.md",
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
        Prefix: "tenants/acme/agents/marco/ideas.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/notes.md/",
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
      "tenants/acme/agents/marco/ideas.md",
    );
    expect(s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input.Key).toBe(
      "tenants/acme/agents/marco/notes.md",
    );
  });

  it("rejects an exact rename when the destination already exists", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/notes.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(HeadObjectCommand, {
        Key: "tenants/acme/agents/marco/ideas.md",
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
        Prefix: "tenants/acme/agents/marco/archive/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/events/",
      })
      .resolves({
        Contents: [
          { Key: "tenants/acme/agents/marco/events/a.md" },
          { Key: "tenants/acme/agents/marco/events/nested/b.md" },
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
      "tenants/acme/agents/marco/archive/a.md",
      "tenants/acme/agents/marco/archive/nested/b.md",
    ]);
    expect(
      s3Mock
        .commandCalls(DeleteObjectCommand)
        .map((call) => call.args[0].input.Key)
        .sort(),
    ).toEqual([
      "tenants/acme/agents/marco/events/a.md",
      "tenants/acme/agents/marco/events/nested/b.md",
    ]);
  });

  it("rejects renaming a folder into one of its descendants", async () => {
    authMockImpl.mockResolvedValue(authOk());
    adminAgentRows();
    destinationMissing();
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/events/",
      })
      .resolves({
        Contents: [{ Key: "tenants/acme/agents/marco/events/nested/a.md" }],
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
        Prefix: "tenants/acme/agents/marco/ROUTES.md/",
      })
      .resolves({ Contents: [] });
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/AGENTS.md/",
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
        Key: "tenants/acme/agents/marco/AGENTS.md",
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
      "tenants/acme/agents/marco/workspaces/support/CONTEXT.md",
      "tenants/acme/agents/marco/AGENTS.md",
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
        Prefix: "tenants/acme/agents/marco/",
      })
      .resolves({
        Contents: [
          {
            Key: "tenants/acme/agents/marco/workspaces/expenses/CONTEXT.md",
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
        Key: "tenants/acme/agents/marco/expenses/CONTEXT.md",
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
      Contents: [{ Key: "tenants/acme/agents/marco/SOUL.md" }],
    });
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/marco/SOUL.md",
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
        Key: "tenants/acme/agents/marco/AGENTS.md",
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
    expect(put?.Key).toBe("tenants/acme/agents/marco/AGENTS.md");
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
        Key: "tenants/acme/agents/marco/AGENTS.md",
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
        Key: "tenants/acme/agents/marco/AGENTS.md",
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
        Key: "tenants/acme/agents/marco/AGENTS.md",
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

describe("space-local agent profiles (plan 2026-06-12-002 U7)", () => {
  const PROFILE_CONTENT =
    "---\nname: Research\nmodel: claude-haiku-4-5\nenabled: true\n---\n\n# Instructions\n\nDo research.\n";

  it("PUT to a Space target agents/<slug>.md is allowed and projects a space-scoped profile", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          spaceId: SPACE_ID,
          path: "agents/research.md",
          content: PROFILE_CONTENT,
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "test-bucket",
      Key: "tenants/acme/spaces/engineering/agents/research.md",
      Body: PROFILE_CONTENT,
    });
    expect(upsertSpaceAgentProfileProjectionMock).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      spaceId: SPACE_ID,
      path: "agents/research.md",
      content: PROFILE_CONTENT,
    });
    expect(upsertAgentProfileProjectionMock).not.toHaveBeenCalled();
  });

  it("PUT returns 400 with the validation error when the space projection fails (file already saved)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});
    upsertSpaceAgentProfileProjectionMock.mockRejectedValueOnce(
      new Error("Model is not available: bogus-model"),
    );

    const res = await parse(
      await handler(
        event({
          action: "put",
          spaceId: SPACE_ID,
          path: "agents/research.md",
          content: PROFILE_CONTENT,
        }),
      ),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/projection refresh failed/);
    expect(res.body.error).toMatch(/Model is not available/);
    // S3 commit happens before projection (mirrors the central path).
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it("DELETE of a Space target agents/<slug>.md removes the space-local projection", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "delete",
          spaceId: SPACE_ID,
          path: "agents/research.md",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(
      s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Key: "tenants/acme/spaces/engineering/agents/research.md",
    });
    expect(deleteSpaceAgentProfileProjectionMock).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      spaceId: SPACE_ID,
      path: "agents/research.md",
    });
    expect(deleteAgentProfileProjectionMock).not.toHaveBeenCalled();
  });

  it("Space puts/deletes of non-profile paths do not touch the projection", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminSpaceTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          spaceId: SPACE_ID,
          path: "knowledge/notes.md",
          content: "# Notes\n",
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(upsertSpaceAgentProfileProjectionMock).not.toHaveBeenCalled();
  });

  it("central agent-target agents/<slug>.md still routes through the central projection (regression)", async () => {
    authMockImpl.mockResolvedValue(authOk());
    queueAdminAgentTargetRows();
    s3Mock.on(PutObjectCommand).resolves({});

    const res = await parse(
      await handler(
        event({
          action: "put",
          agentId: AGENT_ID,
          path: "agents/research.md",
          content: PROFILE_CONTENT,
        }),
      ),
    );

    expect(res.statusCode).toBe(200);
    expect(upsertAgentProfileProjectionMock).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      path: "agents/research.md",
      content: PROFILE_CONTENT,
    });
    expect(upsertSpaceAgentProfileProjectionMock).not.toHaveBeenCalled();
  });
});
