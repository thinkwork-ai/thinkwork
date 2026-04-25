import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

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
  const selectChain = () => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => {
        const fn: any = () => Promise.resolve(dbQueue.shift() ?? []);
        fn.then = (o: any, r: any) =>
          Promise.resolve(dbQueue.shift() ?? []).then(o, r);
        fn.limit = vi
          .fn()
          .mockImplementation(() => Promise.resolve(dbQueue.shift() ?? []));
        return fn;
      }),
    })),
  });
  return {
    db: { select: vi.fn().mockImplementation(() => selectChain()) },
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...args: unknown[]) => ({ __and: args }),
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

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn().mockResolvedValue("tenant-a"),
}));

const s3Mock = mockClient(S3Client);
process.env.WORKSPACE_BUCKET = "test-bucket";

import { agentPinStatus } from "../graphql/resolvers/agents/agentPinStatus.query.js";
import { clearComposerCacheForTests } from "../lib/workspace-overlay.js";

const AGENT_ID = "agent-1";
const TENANT_ID = "tenant-a";
const TEMPLATE_ID = "template-1";

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    slug: "marco",
    name: "Marco",
    tenant_id: TENANT_ID,
    template_id: TEMPLATE_ID,
    human_pair_id: null,
    agent_pinned_versions: null,
    ...overrides,
  };
}

function tenantRow() {
  return { id: TENANT_ID, slug: "acme", name: "Acme" };
}

function templateRow() {
  return { id: TEMPLATE_ID, slug: "exec" };
}

function body(content: string) {
  return {
    Body: {
      transformToString: async () => content,
    } as unknown as never,
  };
}

function sha(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function notFound() {
  return { name: "NotFound", $metadata: { httpStatusCode: 404 } };
}

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

function templateKey(path: string) {
  return `tenants/acme/agents/_catalog/exec/workspace/${path}`;
}

function versionKey(path: string, hex: string) {
  return `tenants/acme/agents/_catalog/exec/workspace-versions/${path}@sha256:${hex}`;
}

function queueResolverAndComposerContext(agent = agentRow()) {
  pushDbRows([agent]); // agentPinStatus agent lookup
  pushDbRows([tenantRow()]);
  pushDbRows([templateRow()]);
  pushDbRows([agent]); // composeList loadAgentContext
  pushDbRows([tenantRow()]);
  pushDbRows([templateRow()]);
}

beforeEach(() => {
  s3Mock.reset();
  resetDbQueue();
  clearComposerCacheForTests();
  s3Mock.on(HeadObjectCommand).rejects(notFound());
  s3Mock.on(GetObjectCommand).rejects(noSuchKey());
});

afterEach(() => {
  expect(dbQueue.length, "test left unconsumed DB rows in the queue").toBe(0);
});

describe("agentPinStatus", () => {
  it("keeps default response root-only for older filename-keyed clients", async () => {
    const root = "# Root guardrails";
    pushDbRows([
      agentRow({
        agent_pinned_versions: {
          "GUARDRAILS.md": `sha256:${sha(root)}`,
          "expenses/GUARDRAILS.md": `sha256:${sha("# Nested")}`,
        },
      }),
    ]);
    pushDbRows([tenantRow()]);
    pushDbRows([templateRow()]);
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .resolves(body(root));
    s3Mock
      .on(GetObjectCommand, { Key: versionKey("GUARDRAILS.md", sha(root)) })
      .resolves(body(root));

    const rows = await agentPinStatus(null, { agentId: AGENT_ID }, {} as any);

    expect(rows.map((row) => row.path).sort()).toEqual([
      "CAPABILITIES.md",
      "GUARDRAILS.md",
      "PLATFORM.md",
    ]);
  });

  it("returns root and nested pin rows keyed by path", async () => {
    const root = "# Root guardrails";
    const nestedOld = "# Old expenses guardrails";
    const nestedLatest = "# New expenses guardrails";
    const rootHex = sha(root);
    const nestedOldHex = sha(nestedOld);
    queueResolverAndComposerContext(
      agentRow({
        agent_pinned_versions: {
          "GUARDRAILS.md": `sha256:${rootHex}`,
          "expenses/GUARDRAILS.md": `sha256:${nestedOldHex}`,
        },
      }),
    );
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/_catalog/exec/workspace/expenses/GUARDRAILS.md",
        },
      ],
    });
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .resolves(body(root));
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("expenses/GUARDRAILS.md") })
      .resolves(body(nestedLatest));
    s3Mock
      .on(GetObjectCommand, { Key: versionKey("GUARDRAILS.md", rootHex) })
      .resolves(body(root));
    s3Mock
      .on(GetObjectCommand, {
        Key: versionKey("expenses/GUARDRAILS.md", nestedOldHex),
      })
      .resolves(body(nestedOld));

    const rows = await agentPinStatus(
      null,
      { agentId: AGENT_ID, includeNested: true },
      {} as any,
    );

    const byPath = Object.fromEntries(rows.map((row) => [row.path, row]));
    expect(byPath["GUARDRAILS.md"]).toMatchObject({
      path: "GUARDRAILS.md",
      folderPath: null,
      filename: "GUARDRAILS.md",
      updateAvailable: false,
      pinnedContent: root,
      latestContent: root,
    });
    expect(byPath["expenses/GUARDRAILS.md"]).toMatchObject({
      path: "expenses/GUARDRAILS.md",
      folderPath: "expenses",
      filename: "GUARDRAILS.md",
      updateAvailable: true,
      pinnedContent: nestedOld,
      latestContent: nestedLatest,
    });
  });

  it("uses latest content when no pin is recorded for a nested pinned path", async () => {
    const latest = "# Latest";
    queueResolverAndComposerContext(agentRow({ agent_pinned_versions: {} }));
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/_catalog/exec/workspace/expenses/GUARDRAILS.md",
        },
      ],
    });
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/defaults/workspace/GUARDRAILS.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("expenses/GUARDRAILS.md") })
      .resolves(body(latest));

    const rows = await agentPinStatus(
      null,
      { agentId: AGENT_ID, includeNested: true },
      {} as any,
    );
    const nested = rows.find((row) => row.path === "expenses/GUARDRAILS.md");

    expect(nested).toMatchObject({
      pinnedSha: null,
      latestSha: `sha256:${sha(latest)}`,
      updateAvailable: false,
      pinnedContent: null,
      latestContent: latest,
    });
  });

  it("uses inherited root latest content for nested pinned paths without nested base content", async () => {
    const rootOld = "# Old root";
    const rootLatest = "# Latest root";
    queueResolverAndComposerContext(
      agentRow({
        agent_pinned_versions: {
          "GUARDRAILS.md": `sha256:${sha(rootOld)}`,
        },
      }),
    );
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/_catalog/exec/workspace/expenses/GUARDRAILS.md",
        },
      ],
    });
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("expenses/GUARDRAILS.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/defaults/workspace/expenses/GUARDRAILS.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .resolves(body(rootLatest));
    s3Mock
      .on(GetObjectCommand, { Key: versionKey("GUARDRAILS.md", sha(rootOld)) })
      .resolves(body(rootOld));

    const rows = await agentPinStatus(
      null,
      { agentId: AGENT_ID, includeNested: true },
      {} as any,
    );
    const nested = rows.find((row) => row.path === "expenses/GUARDRAILS.md");

    expect(nested).toMatchObject({
      pinnedSha: `sha256:${sha(rootOld)}`,
      latestSha: `sha256:${sha(rootLatest)}`,
      updateAvailable: true,
      pinnedContent: rootOld,
      latestContent: rootLatest,
    });
  });

  it("includes path-qualified pins even when their current workspace path is absent", async () => {
    const pinned = "# Stored nested";
    const pinnedHex = sha(pinned);
    queueResolverAndComposerContext(
      agentRow({
        agent_pinned_versions: {
          "expenses/GUARDRAILS.md": `sha256:${pinnedHex}`,
        },
      }),
    );
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("expenses/GUARDRAILS.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/defaults/workspace/expenses/GUARDRAILS.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: versionKey("expenses/GUARDRAILS.md", pinnedHex),
      })
      .resolves(body(pinned));

    const rows = await agentPinStatus(
      null,
      { agentId: AGENT_ID, includeNested: true },
      {} as any,
    );

    expect(
      rows.find((row) => row.path === "expenses/GUARDRAILS.md"),
    ).toMatchObject({
      pinnedSha: `sha256:${pinnedHex}`,
      latestSha: null,
      updateAvailable: false,
      pinnedContent: pinned,
      latestContent: null,
    });
  });

  it("keeps updateAvailable true when an old pin is missing from the version store", async () => {
    const latest = "# Latest";
    const oldHex = sha("# Missing old content");
    queueResolverAndComposerContext(
      agentRow({
        agent_pinned_versions: {
          "expenses/GUARDRAILS.md": `sha256:${oldHex}`,
        },
      }),
    );
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "tenants/acme/agents/_catalog/exec/workspace/expenses/GUARDRAILS.md",
        },
      ],
    });
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("GUARDRAILS.md") })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, {
        Key: "tenants/acme/agents/_catalog/defaults/workspace/GUARDRAILS.md",
      })
      .rejects(noSuchKey());
    s3Mock
      .on(GetObjectCommand, { Key: templateKey("expenses/GUARDRAILS.md") })
      .resolves(body(latest));
    s3Mock
      .on(GetObjectCommand, {
        Key: versionKey("expenses/GUARDRAILS.md", oldHex),
      })
      .rejects(noSuchKey());

    const rows = await agentPinStatus(
      null,
      { agentId: AGENT_ID, includeNested: true },
      {} as any,
    );
    const nested = rows.find((row) => row.path === "expenses/GUARDRAILS.md");

    expect(nested).toMatchObject({
      pinnedSha: `sha256:${oldHex}`,
      latestSha: `sha256:${sha(latest)}`,
      updateAvailable: true,
      pinnedContent: null,
      latestContent: latest,
    });
  });

  it("returns not found for cross-tenant agent lookup", async () => {
    pushDbRows([
      agentRow({
        tenant_id: "other-tenant",
      }),
    ]);

    await expect(
      agentPinStatus(null, { agentId: AGENT_ID }, {} as any),
    ).rejects.toThrow(/Agent not found/);
  });
});
