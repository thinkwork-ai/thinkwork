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

let createMod: typeof import("./createSkillDraft.mutation.js");
let updateMod: typeof import("./updateSkillDraft.mutation.js");
let submitMod: typeof import("./submitSkillDraft.mutation.js");
let rejectMod: typeof import("./rejectSkillDraft.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  resetHarness();
  createMod = await import("./createSkillDraft.mutation.js");
  updateMod = await import("./updateSkillDraft.mutation.js");
  submitMod = await import("./submitSkillDraft.mutation.js");
  rejectMod = await import("./rejectSkillDraft.mutation.js");
});

const ctx = { auth: { authType: "cognito" } } as any;

describe("skill draft lifecycle", () => {
  it("creates a tenant-scoped draft with source metadata and an event", async () => {
    const draft = await createMod.createSkillDraft(
      null,
      {
        input: {
          slug: "crm-summary",
          title: "CRM Summary",
          source: { kind: "thread", threadId: "thread-1" },
          currentContentHash: "sha256:a",
        },
      },
      ctx,
    );

    expect(draft).toMatchObject({
      tenantId: "tenant-1",
      slug: "crm-summary",
      status: "draft",
      currentContentHash: "sha256:a",
      draftS3Prefix: expect.stringMatching(
        /^tenants\/acme\/skill-drafts\/.+\/$/,
      ),
      source: { kind: "thread", threadId: "thread-1" },
    });
    expect(rows.skillDraftEvents).toEqual([
      expect.objectContaining({
        event_type: "created",
        actor_user_id: "user-1",
      }),
    ]);
  });

  it("updates requester-owned editable drafts and records content hash changes", async () => {
    rows.skillDrafts.push({
      id: "draft-1",
      tenant_id: "tenant-1",
      requested_by_user_id: "user-1",
      slug: "old",
      title: "Old",
      source_kind: "thread",
      status: "draft",
      current_content_hash: "sha256:a",
      draft_s3_prefix: "tenants/acme/skill-drafts/draft-1/",
      created_at: new Date(),
      updated_at: new Date(),
    });

    const draft = await updateMod.updateSkillDraft(
      null,
      {
        input: {
          id: "draft-1",
          slug: "new-skill",
          title: "New Skill",
          currentContentHash: "sha256:b",
        },
      },
      ctx,
    );

    expect(draft).toMatchObject({
      slug: "new-skill",
      title: "New Skill",
      currentContentHash: "sha256:b",
    });
    expect(rows.skillDraftEvents.at(-1)).toMatchObject({
      event_type: "updated",
      payload: { contentHashChanged: true },
    });
  });

  it("submits an editable draft and locks further author edits", async () => {
    rows.skillDrafts.push({
      id: "draft-1",
      tenant_id: "tenant-1",
      requested_by_user_id: "user-1",
      slug: "crm",
      title: "CRM",
      source_kind: "thread",
      status: "draft",
      current_content_hash: "sha256:a",
      draft_s3_prefix: "tenants/acme/skill-drafts/draft-1/",
      created_at: new Date(),
      updated_at: new Date(),
    });

    const submitted = await submitMod.submitSkillDraft(
      null,
      { input: { id: "draft-1" } },
      ctx,
    );

    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    await expect(
      updateMod.updateSkillDraft(
        null,
        { input: { id: "draft-1", title: "Late edit" } },
        ctx,
      ),
    ).rejects.toThrow(/not editable/i);
  });

  it("requires tenant-operator authority before rejecting a draft", async () => {
    rows.skillDrafts.push({
      id: "draft-1",
      tenant_id: "tenant-1",
      requested_by_user_id: "user-2",
      slug: "crm",
      title: "CRM",
      source_kind: "thread",
      status: "submitted",
      current_content_hash: "sha256:a",
      draft_s3_prefix: "tenants/acme/skill-drafts/draft-1/",
      created_at: new Date(),
      updated_at: new Date(),
    });
    authMocks.resolveCallerUserId.mockResolvedValue("admin-1");

    const rejected = await rejectMod.rejectSkillDraft(
      null,
      { input: { id: "draft-1", rationale: "Needs narrower scope" } },
      ctx,
    );

    expect(authMocks.requireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(rejected).toMatchObject({
      status: "rejected",
      failureMessage: "Needs narrower scope",
    });
    expect(rows.skillDraftEvents.at(-1)).toMatchObject({
      event_type: "rejected",
      actor_user_id: "admin-1",
    });
  });

  it("does not let a non-requester edit another user's draft", async () => {
    rows.skillDrafts.push({
      id: "draft-foreign",
      tenant_id: "tenant-1",
      requested_by_user_id: "user-2",
      slug: "crm",
      title: "CRM",
      source_kind: "thread",
      status: "draft",
      current_content_hash: "sha256:a",
      draft_s3_prefix: "tenants/acme/skill-drafts/draft-foreign/",
      created_at: new Date(),
      updated_at: new Date(),
    });

    await expect(
      updateMod.updateSkillDraft(
        null,
        { input: { id: "draft-foreign", title: "Nope" } },
        ctx,
      ),
    ).rejects.toThrow(/requester/i);
  });
});
