/**
 * Integration tests for setAgentSkills' write-time subset enforcement
 * (Unit 5 of docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md).
 *
 * The invariant under test:
 *   agent.permissions.operations ⊆
 *     template.skills[skillId].permissions.operations ⊆
 *       skill_catalog.tier1_metadata.scripts[*].name (where default_enabled)
 *
 * Fires only for skills whose manifest declares
 * `permissions_model: operations`. Non-opt-in skills retain their
 * existing free-form permissions jsonb shape — the resolver skips
 * the subset check for them entirely (backward compat).
 *
 * Separate file from agents-authz.test.ts because this suite needs
 * ordered per-query mock results (agent lookup → catalog rows →
 * template skills → existing agent_skills → upsert) instead of a
 * single "every select returns the same rows" mock shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelectQueue,
  mockRequireTenantAdmin,
  upsertCallRef,
  lastUpsertSet,
} = vi.hoisted(() => ({
  mockSelectQueue: [] as unknown[][],
  mockRequireTenantAdmin: vi.fn(),
  upsertCallRef: { value: 0 },
  lastUpsertSet: { value: null as any },
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            (mockSelectQueue.length > 0
              ? mockSelectQueue.shift()
              : []) as unknown[],
          ),
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoUpdate: (opts: { set: Record<string, unknown> }) => {
          upsertCallRef.value++;
          lastUpsertSet.value = opts?.set;
          return Promise.resolve();
        },
      }),
    })),
    delete: vi.fn(() => ({ where: () => Promise.resolve() })),
  },
  eq: (..._args: any[]) => ({ _eq: _args }),
  and: (..._args: any[]) => ({ _and: _args }),
  inArray: (..._args: any[]) => ({ _in: _args }),
  agents: { id: "agents.id", tenant_id: "agents.tenant_id", template_id: "agents.template_id" },
  agentSkills: {
    agent_id: "agentSkills.agent_id",
    skill_id: "agentSkills.skill_id",
    tenant_id: "agentSkills.tenant_id",
  },
  agentTemplates: { id: "agentTemplates.id", skills: "agentTemplates.skills" },
  snakeToCamel: (obj: Record<string, unknown>) => obj,
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../lib/workspace-map-generator.js", () => ({
  regenerateWorkspaceMap: () => Promise.resolve(),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  skillCatalog: {
    slug: "skillCatalog.slug",
    tier1_metadata: "skillCatalog.tier1_metadata",
  },
}));

// eslint-disable-next-line import/first
import { setAgentSkills } from "../graphql/resolvers/agents/setAgentSkills.mutation.js";

function cognitoCtx(): any {
  return {
    auth: { authType: "cognito", principalId: "sub-1", tenantId: null },
  };
}

function adminAllowed() {
  mockRequireTenantAdmin.mockResolvedValue("admin");
}

function queueSelects(...batches: unknown[][]) {
  for (const b of batches) mockSelectQueue.push(b);
}

const ADMIN_MANIFEST_JSON = JSON.stringify({
  slug: "thinkwork-admin",
  permissions_model: "operations",
  scripts: [
    { name: "me", default_enabled: true },
    { name: "list_agents", default_enabled: true },
    { name: "invite_member", default_enabled: true },
    { name: "remove_tenant_member", default_enabled: false },
  ],
});

describe("setAgentSkills — subset enforcement (Unit 5)", () => {
  beforeEach(() => {
    mockSelectQueue.length = 0;
    mockRequireTenantAdmin.mockReset();
    upsertCallRef.value = 0;
    lastUpsertSet.value = null;
  });

  it("allows an agent allowlist that is a strict subset of the template ceiling", async () => {
    adminAllowed();
    queueSelects(
      // 1. agent lookup
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      // 2. skill_catalog rows for [thinkwork-admin]
      [{ slug: "thinkwork-admin", tier1_metadata: ADMIN_MANIFEST_JSON }],
      // 3. template's skills jsonb
      [
        {
          skills: [
            {
              skill_id: "thinkwork-admin",
              permissions: { operations: ["me", "list_agents", "invite_member"] },
            },
          ],
        },
      ],
      // 4. existing agent_skills
      [],
      // 5. returning rows after upsert
      [],
    );
    await setAgentSkills(
      null,
      {
        agentId: "agent-1",
        skills: [
          {
            skillId: "thinkwork-admin",
            permissions: { operations: ["me", "list_agents"] },
            enabled: true,
          },
        ],
      },
      cognitoCtx(),
    );
    expect(upsertCallRef.value).toBe(1);
  });

  it("rejects an agent allowlist that adds an op not authorized by the template", async () => {
    adminAllowed();
    queueSelects(
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      [{ slug: "thinkwork-admin", tier1_metadata: ADMIN_MANIFEST_JSON }],
      [
        {
          skills: [
            {
              skill_id: "thinkwork-admin",
              permissions: { operations: ["me", "list_agents"] },
            },
          ],
        },
      ],
    );
    await expect(
      setAgentSkills(
        null,
        {
          agentId: "agent-1",
          skills: [
            {
              skillId: "thinkwork-admin",
              permissions: { operations: ["me", "invite_member"] },
              enabled: true,
            },
          ],
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT", skillId: "thinkwork-admin" },
    });
    expect(upsertCallRef.value).toBe(0);
  });

  it("rejects an agent allowlist with an op not declared in the manifest (typo / fabricated)", async () => {
    adminAllowed();
    queueSelects(
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      [{ slug: "thinkwork-admin", tier1_metadata: ADMIN_MANIFEST_JSON }],
      [
        {
          skills: [
            {
              skill_id: "thinkwork-admin",
              permissions: {
                operations: ["invite_memeber" /* typo */, "me"],
              },
            },
          ],
        },
      ],
    );
    await expect(
      setAgentSkills(
        null,
        {
          agentId: "agent-1",
          skills: [
            {
              skillId: "thinkwork-admin",
              permissions: { operations: ["invite_memeber"] },
              enabled: true,
            },
          ],
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
    expect(upsertCallRef.value).toBe(0);
  });

  it("accepts null agent permissions (inheriting) without requiring any template ops to be set", async () => {
    adminAllowed();
    queueSelects(
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      [{ slug: "thinkwork-admin", tier1_metadata: ADMIN_MANIFEST_JSON }],
      // Template has no permissions for thinkwork-admin yet — fine because
      // the agent is inheriting (null). Inheritance is always valid.
      [{ skills: [{ skill_id: "thinkwork-admin" }] }],
      [],
      [],
    );
    await setAgentSkills(
      null,
      {
        agentId: "agent-1",
        skills: [{ skillId: "thinkwork-admin", enabled: true }], // no `permissions` key
      },
      cognitoCtx(),
    );
    expect(upsertCallRef.value).toBe(1);
    // Defensive guard: because permissions was not provided, the `set`
    // clause of onConflictDoUpdate must NOT include a `permissions` key
    // (prevents clobbering existing jsonb in the mobile-deferral case).
    expect(lastUpsertSet.value).toBeDefined();
    expect("permissions" in lastUpsertSet.value).toBe(false);
  });

  it("skips subset enforcement for skills that do not opt into permissions_model: operations", async () => {
    // MCP-style skill: free-form permissions jsonb, no subset check.
    const NON_OPT_IN_MANIFEST = JSON.stringify({
      slug: "some-mcp-skill",
      scripts: [{ name: "anything", default_enabled: true }],
      // NOTE: no `permissions_model` key
    });
    adminAllowed();
    queueSelects(
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      [{ slug: "some-mcp-skill", tier1_metadata: NON_OPT_IN_MANIFEST }],
      // No template skills query runs when no opt-in skill is in the
      // payload — the resolver short-circuits. Queue two more just in
      // case delete/existing selects fire.
      [],
      [],
      [],
    );
    await setAgentSkills(
      null,
      {
        agentId: "agent-1",
        skills: [
          {
            skillId: "some-mcp-skill",
            // Free-form permissions jsonb — arbitrary shape, must pass through.
            permissions: { arbitraryKey: "arbitraryValue" },
            enabled: true,
          },
        ],
      },
      cognitoCtx(),
    );
    // Subset check was skipped; upsert ran.
    expect(upsertCallRef.value).toBe(1);
  });

  it("defensive guard: omits `permissions` from the update SET clause when caller didn't send it", async () => {
    adminAllowed();
    queueSelects(
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      [],
      [],
      [],
    );
    await setAgentSkills(
      null,
      {
        agentId: "agent-1",
        skills: [
          // A skill not in the catalog at all — subset check skipped, upsert proceeds.
          { skillId: "some-unknown-skill", enabled: true },
        ],
      },
      cognitoCtx(),
    );
    expect(upsertCallRef.value).toBe(1);
    expect("permissions" in lastUpsertSet.value).toBe(false);
  });

  it("includes `permissions` in the update SET clause when caller DID send it", async () => {
    adminAllowed();
    queueSelects(
      [{ tenant_id: "tenant-A", template_id: "tpl-1" }],
      [],
      [],
      [],
    );
    await setAgentSkills(
      null,
      {
        agentId: "agent-1",
        skills: [
          {
            skillId: "some-unknown-skill",
            permissions: { arbitraryKey: "v" },
            enabled: true,
          },
        ],
      },
      cognitoCtx(),
    );
    expect(upsertCallRef.value).toBe(1);
    expect(lastUpsertSet.value.permissions).toEqual({ arbitraryKey: "v" });
  });
});
