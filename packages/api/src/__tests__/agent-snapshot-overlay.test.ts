/**
 * Unit 5: agent-snapshot readWorkspaceFiles now flows through the composer.
 *
 * Verifies the composed 13-file view is captured — not just the sparse set
 * of files sitting at the agent's own S3 prefix. This is what makes
 * rollback safe for a fresh-off-template agent that has no overrides yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

// ─── Hoisted DB mock (shared shape with other composer tests) ────────────────

const { dbQueue, pushDbRows, resetDbQueue } = vi.hoisted(() => {
  const queue: unknown[][] = [];
  return {
    dbQueue: queue,
    pushDbRows: (rows: unknown[]) => queue.push(rows),
    resetDbQueue: () => {
      queue.length = 0;
    },
  };
});

vi.mock("../graphql/utils.js", () => {
  const tableCol = (label: string) => ({ __col: label });
  const chain = () => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        // Drizzle's `.where()` returns a thenable so callers can
        // `await` it directly; mirror that here so the new
        // agent-prefix readWorkspaceFiles path works.
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
    db: { select: vi.fn().mockImplementation(() => chain()) },
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...args: unknown[]) => ({ __and: args }),
    sql: (...args: unknown[]) => ({ __sql: args }),
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
    },
    userProfiles: {
      user_id: tableCol("user_profiles.user_id"),
      title: tableCol("user_profiles.title"),
      timezone: tableCol("user_profiles.timezone"),
      pronouns: tableCol("user_profiles.pronouns"),
    },
  };
});

const s3Mock = mockClient(S3Client);
process.env.WORKSPACE_BUCKET = "test-bucket";

import { readWorkspaceFiles } from "../lib/agent-snapshot.js";
import { clearComposerCacheForTests } from "../lib/workspace-overlay.js";

const TENANT_ID = "tenant-a";
const AGENT_ID = "agent-marco";

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

function agentRow() {
  return {
    id: AGENT_ID,
    slug: "marco",
    name: "Marco",
    tenant_id: TENANT_ID,
    template_id: "template-exec",
    human_pair_id: null,
    agent_pinned_versions: null,
  };
}

function tenantRow() {
  return { id: TENANT_ID, slug: "acme", name: "Acme" };
}

function templateRow() {
  return { id: "template-exec", slug: "exec-assistant" };
}

beforeEach(() => {
  s3Mock.reset();
  resetDbQueue();
  clearComposerCacheForTests();
});

describe("readWorkspaceFiles (agent-prefix direct)", () => {
  it("returns the bytes at the agent's S3 prefix (no overlay, no template fallback)", async () => {
    // Per docs/plans/2026-04-27-003: the snapshot captures whatever
    // is at the agent's prefix — that IS the agent's state. The
    // overlay-era "13-file composed view" assertion is gone with
    // the composer.
    pushDbRows([agentRow()]); // readWorkspaceFiles agent lookup
    pushDbRows([tenantRow()]); // resolveTenantSlug

    const PRESENT = ["AGENTS.md", "IDENTITY.md", "memory/lessons.md"];
    s3Mock
      .on(ListObjectsV2Command, {
        Prefix: "tenants/acme/agents/marco/workspace/",
      })
      .resolves({
        Contents: PRESENT.map((p) => ({
          Key: `tenants/acme/agents/marco/workspace/${p}`,
        })),
      } as never);
    for (const path of PRESENT) {
      s3Mock
        .on(GetObjectCommand, {
          Key: `tenants/acme/agents/marco/workspace/${path}`,
        })
        .resolves(body(`# ${path} for Marco`));
    }

    const snapshot = await readWorkspaceFiles(TENANT_ID, AGENT_ID);

    for (const path of PRESENT) {
      expect(snapshot).toHaveProperty(path);
      expect(snapshot[path]).toContain("Marco");
    }
    // What is NOT at the agent prefix is NOT in the snapshot. No
    // fallback to template / defaults.
    expect(snapshot).not.toHaveProperty("SOUL.md");
  });

  it("returns {} when WORKSPACE_BUCKET is not configured", async () => {
    const prev = process.env.WORKSPACE_BUCKET;
    delete process.env.WORKSPACE_BUCKET;
    const out = await readWorkspaceFiles(TENANT_ID, AGENT_ID);
    expect(out).toEqual({});
    process.env.WORKSPACE_BUCKET = prev;
  });
});
