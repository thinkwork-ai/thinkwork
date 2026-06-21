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

let listMod: typeof import("./skillDrafts.query.js");
let detailMod: typeof import("./skillDraft.query.js");

beforeEach(async () => {
  vi.resetModules();
  resetHarness();
  rows.skillDrafts.push(
    {
      id: "draft-1",
      tenant_id: "tenant-1",
      requested_by_user_id: "user-1",
      slug: "mine",
      title: "Mine",
      source_kind: "thread",
      status: "draft",
      draft_s3_prefix: "tenants/acme/skill-drafts/draft-1/",
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: "draft-2",
      tenant_id: "tenant-1",
      requested_by_user_id: "user-2",
      slug: "theirs",
      title: "Theirs",
      source_kind: "archive",
      status: "submitted",
      draft_s3_prefix: "tenants/acme/skill-drafts/draft-2/",
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: "draft-3",
      tenant_id: "tenant-2",
      requested_by_user_id: "user-1",
      slug: "foreign",
      title: "Foreign",
      source_kind: "manual",
      status: "draft",
      draft_s3_prefix: "tenants/other/skill-drafts/draft-3/",
      created_at: new Date(),
      updated_at: new Date(),
    },
  );
  listMod = await import("./skillDrafts.query.js");
  detailMod = await import("./skillDraft.query.js");
});

const ctx = { auth: { authType: "cognito" } } as any;

describe("skill draft queries", () => {
  it("returns only requester-owned drafts for a non-operator", async () => {
    authMocks.requireTenantAdmin.mockRejectedValue(new Error("not admin"));

    const drafts = await listMod.skillDraftsQuery(null, {}, ctx);

    expect(drafts.map((draft) => draft.id)).toEqual(["draft-1"]);
    expect(drafts[0]).toMatchObject({
      requester: { id: "user-1", name: "Ada" },
    });
  });

  it("returns tenant-wide drafts for an operator and supports filters", async () => {
    const drafts = await listMod.skillDraftsQuery(
      null,
      { status: "submitted", requesterId: "user-2" },
      ctx,
    );

    expect(drafts.map((draft) => draft.id)).toEqual(["draft-2"]);
    expect(authMocks.requireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-1");
  });

  it("lets a requester read their own draft detail with events", async () => {
    rows.skillDraftEvents.push({
      id: "event-1",
      tenant_id: "tenant-1",
      draft_id: "draft-1",
      actor_user_id: "user-1",
      event_type: "created",
      payload: {},
      created_at: new Date(),
    });
    authMocks.requireTenantAdmin.mockRejectedValue(new Error("not admin"));

    const draft = await detailMod.skillDraft(null, { id: "draft-1" }, ctx);

    expect(draft).toMatchObject({
      id: "draft-1",
      events: [expect.objectContaining({ eventType: "created" })],
    });
  });

  it("does not expose another user's same-tenant draft to a non-operator", async () => {
    authMocks.requireTenantAdmin.mockRejectedValue(new Error("not admin"));

    await expect(
      detailMod.skillDraft(null, { id: "draft-2" }, ctx),
    ).rejects.toThrow(/not found/i);
  });

  it("fails closed across tenants", async () => {
    await expect(
      detailMod.skillDraft(null, { id: "draft-3" }, ctx),
    ).rejects.toThrow(/not found/i);
  });
});
