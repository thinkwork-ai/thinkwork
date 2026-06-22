import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  and,
  asc,
  authMocks,
  db,
  desc,
  eq,
  inArray,
  resetHarness,
  rows,
  tables,
} from "./test-harness.test-support.js";

const publishMocks = vi.hoisted(() => ({
  publishSkillDraftToCatalog: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  skillDraftEvents: tables.skillDraftEvents,
  skillDrafts: tables.skillDrafts,
  tenants: tables.tenants,
  threads: tables.threads,
  users: tables.users,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: authMocks.requireTenantAdmin,
  requireTenantMember: authMocks.requireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: authMocks.resolveCaller,
  resolveCallerTenantId: authMocks.resolveCallerTenantId,
  resolveCallerUserId: authMocks.resolveCallerUserId,
}));

vi.mock("../../../lib/skill-drafts/publish-catalog.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/skill-drafts/publish-catalog.js")
  >("../../../lib/skill-drafts/publish-catalog.js");
  return {
    ...actual,
    publishSkillDraftToCatalog: publishMocks.publishSkillDraftToCatalog,
  };
});

let mod: typeof import("./publishSkillDraft.mutation.js");
let publishLib: typeof import("../../../lib/skill-drafts/publish-catalog.js");

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(async () => {
  vi.resetModules();
  resetHarness();
  publishMocks.publishSkillDraftToCatalog.mockReset().mockResolvedValue({
    slug: "crm",
    contentHash: "abc123",
    replaced: false,
    generatedWiring: true,
    trustReport: {
      status: "passed",
      scanner: { status: "completed" },
    },
  });
  authMocks.resolveCallerUserId.mockResolvedValue("admin-1");
  publishLib = await import("../../../lib/skill-drafts/publish-catalog.js");
  mod = await import("./publishSkillDraft.mutation.js");
});

function submittedDraft() {
  rows.skillDrafts.push({
    id: "draft-1",
    tenant_id: "tenant-1",
    requested_by_user_id: "user-1",
    slug: "crm",
    title: "CRM",
    source_kind: "thread",
    status: "submitted",
    current_content_hash: "sha256:a",
    draft_s3_prefix: "tenants/acme/skill-drafts/draft-1/",
    created_at: new Date(),
    updated_at: new Date(),
  });
}

describe("publishSkillDraft", () => {
  it("requires operator authority and marks the draft published", async () => {
    submittedDraft();

    const published = await mod.publishSkillDraft(
      null,
      { input: { id: "draft-1" } },
      ctx,
    );

    expect(authMocks.requireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(publishMocks.publishSkillDraftToCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        tenantSlug: "acme",
        confirmReplace: false,
        draft: expect.objectContaining({ id: "draft-1" }),
      }),
    );
    expect(published).toMatchObject({
      status: "published",
      publishedCatalogSlug: "crm",
      publishedContentHash: "abc123",
    });
    expect(rows.skillDraftEvents.at(-1)).toMatchObject({
      event_type: "published",
      actor_user_id: "admin-1",
      payload: expect.objectContaining({
        slug: "crm",
        contentHash: "abc123",
        trustStatus: "passed",
      }),
    });
  });

  it("passes explicit replacement confirmation to the publish service", async () => {
    submittedDraft();

    await mod.publishSkillDraft(
      null,
      { input: { id: "draft-1", confirmReplace: true } },
      ctx,
    );

    expect(publishMocks.publishSkillDraftToCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ confirmReplace: true }),
    );
  });

  it("surfaces publish readiness failures as GraphQL preconditions", async () => {
    submittedDraft();
    publishMocks.publishSkillDraftToCatalog.mockRejectedValueOnce(
      new publishLib.SkillDraftPublishError(
        "skillspector_required",
        "SkillSpector required.",
        409,
      ),
    );

    await expect(
      mod.publishSkillDraft(null, { input: { id: "draft-1" } }, ctx),
    ).rejects.toMatchObject({
      message: "SkillSpector required.",
      extensions: expect.objectContaining({
        code: "FAILED_PRECONDITION",
        reason: "skillspector_required",
      }),
    });
  });
});
