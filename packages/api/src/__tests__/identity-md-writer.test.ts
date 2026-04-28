/**
 * Tests for writeIdentityMdForAgent — name-line surgery.
 *
 * Contract:
 *   - If an agent-override IDENTITY.md exists at the agent's prefix,
 *     replace ONLY the Name line and PUT the mutated bytes back.
 *     Everything else in the file survives intact (agent-owned prose).
 *   - If no override exists, seed the agent prefix with the template
 *     IDENTITY.md with `{{AGENT_NAME}}` substituted.
 *   - Matches both the new `- **Name:** <x>` bullet shape and the
 *     legacy `Your name is **<x>**.` prose shape.
 *   - Transient S3 PUT failure retries once, then bubbles.
 *   - Composer cache invalidation is the CALLER's responsibility (it
 *     fires after the DB transaction commits in `updateAgent`); the
 *     writer itself no longer invalidates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// ─── Hoisted DB mock (same shape as user-md-writer.test.ts) ──────────────────

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
  const chain = () => ({
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
    db: { select: vi.fn().mockImplementation(() => chain()) },
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  };
});

// ─── S3 mock ─────────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);
process.env.WORKSPACE_BUCKET = "test-bucket";

import {
  IdentityMdWriterError,
  writeIdentityMdForAgent,
} from "../lib/identity-md-writer.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-a";
const AGENT_ID = "agent-marco";

function mockTx() {
  return {
    select: vi.fn().mockImplementation(() => {
      const chain = () => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi
            .fn()
            .mockImplementation(() => Promise.resolve(dbQueue.shift() ?? [])),
        })),
      });
      return chain();
    }),
  } as any;
}

function body(content: string) {
  return {
    Body: {
      transformToString: async () => content,
    } as unknown as never,
  };
}

function noSuchKey() {
  const err = new Error("NoSuchKey");
  err.name = "NoSuchKey";
  return err;
}

function transient500() {
  const err = new Error("InternalError");
  err.name = "InternalError";
  (err as { $metadata?: { httpStatusCode?: number } }).$metadata = {
    httpStatusCode: 500,
  };
  return err;
}

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    slug: "marco",
    name: "Marco",
    tenant_id: TENANT_ID,
    ...overrides,
  };
}

function tenantRow() {
  return { id: TENANT_ID, slug: "acme", name: "Acme" };
}

function queueBase(overrides: Record<string, unknown> = {}) {
  pushDbRows([agentRow(overrides)]);
  pushDbRows([tenantRow()]);
}

const AGENT_IDENTITY_KEY = "tenants/acme/agents/marco/workspace/IDENTITY.md";

beforeEach(() => {
  s3Mock.reset();
  resetDbQueue();
});

// ─── Name-line surgery (new bullet shape) ────────────────────────────────────

describe("writeIdentityMdForAgent — new-shape anchor", () => {
  it("rewrites ONLY the Name bullet line, preserving the rest verbatim", async () => {
    queueBase();
    const existing = [
      "# IDENTITY.md - Who Am I?",
      "",
      "- **Name:** OldName",
      "- **Creature:** wise old fox",
      "- **Vibe:** quick and sharp",
      "- **Emoji:** 🦊",
      "- **Avatar:** *(none yet)*",
      "",
      "---",
      "",
      "Hand-written backstory the agent owns.",
      "",
    ].join("\n");
    s3Mock
      .on(GetObjectCommand, { Key: AGENT_IDENTITY_KEY })
      .resolves(body(existing));
    s3Mock.on(PutObjectCommand).resolves({});

    await writeIdentityMdForAgent(mockTx(), AGENT_ID);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.length).toBe(1);
    expect(puts[0].args[0].input.Key).toBe(AGENT_IDENTITY_KEY);
    const rendered = String(puts[0].args[0].input.Body);

    // Name line updated.
    expect(rendered).toContain("- **Name:** Marco");
    // Agent-owned prose preserved.
    expect(rendered).toContain("- **Creature:** wise old fox");
    expect(rendered).toContain("- **Vibe:** quick and sharp");
    expect(rendered).toContain("- **Emoji:** 🦊");
    expect(rendered).toContain("Hand-written backstory the agent owns.");
    // Old name gone.
    expect(rendered).not.toContain("OldName");
  });
});

// ─── Name-line surgery (legacy prose shape) ──────────────────────────────────

describe("writeIdentityMdForAgent — legacy-shape anchor", () => {
  it("rewrites ONLY the 'Your name is **X**.' sentence", async () => {
    queueBase();
    const existing = [
      "# Identity",
      "",
      "Your name is **OldName**. You are an AI agent powered by Thinkwork.",
      "",
      "You assist users by answering questions, completing tasks, and providing thoughtful guidance. When introducing yourself or referring to yourself, use your name.",
      "",
    ].join("\n");
    s3Mock
      .on(GetObjectCommand, { Key: AGENT_IDENTITY_KEY })
      .resolves(body(existing));
    s3Mock.on(PutObjectCommand).resolves({});

    await writeIdentityMdForAgent(mockTx(), AGENT_ID);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.length).toBe(1);
    const rendered = String(puts[0].args[0].input.Body);

    expect(rendered).toContain(
      "Your name is **Marco**. You are an AI agent powered by Thinkwork.",
    );
    expect(rendered).toContain(
      "You assist users by answering questions, completing tasks",
    );
    expect(rendered).not.toContain("OldName");
  });
});

// ─── No existing override → seed from template ───────────────────────────────

describe("writeIdentityMdForAgent — no existing override", () => {
  it("seeds the agent prefix with the template IDENTITY.md substituted", async () => {
    queueBase();
    s3Mock
      .on(GetObjectCommand, { Key: AGENT_IDENTITY_KEY })
      .rejects(noSuchKey());
    s3Mock.on(PutObjectCommand).resolves({});

    await writeIdentityMdForAgent(mockTx(), AGENT_ID);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.length).toBe(1);
    expect(puts[0].args[0].input.Key).toBe(AGENT_IDENTITY_KEY);
    const rendered = String(puts[0].args[0].input.Body);
    expect(rendered).toContain("- **Name:** Marco");
    expect(rendered).toContain("# IDENTITY.md - Who Am I?");
    expect(rendered).not.toContain("{{AGENT_NAME}}");
  });
});

// ─── No anchor matches (edge case) ───────────────────────────────────────────

describe("writeIdentityMdForAgent — no anchor matches", () => {
  it("falls through to a full template rewrite when neither anchor is found", async () => {
    queueBase();
    // Agent has hand-edited the file into free prose with no Name anchor.
    const existing = [
      "# I am who I am",
      "",
      "I am a creature of the night and a friend to all who seek counsel.",
      "",
    ].join("\n");
    s3Mock
      .on(GetObjectCommand, { Key: AGENT_IDENTITY_KEY })
      .resolves(body(existing));
    s3Mock.on(PutObjectCommand).resolves({});

    await writeIdentityMdForAgent(mockTx(), AGENT_ID);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.length).toBe(1);
    const rendered = String(puts[0].args[0].input.Body);
    // Full rewrite: template content with substituted name.
    expect(rendered).toContain("- **Name:** Marco");
    expect(rendered).toContain("# IDENTITY.md - Who Am I?");
  });
});

// ─── Reliability: transient S3 retry ─────────────────────────────────────────

describe("writeIdentityMdForAgent — reliability", () => {
  it("retries once on transient S3 PUT failure", async () => {
    queueBase();
    s3Mock
      .on(GetObjectCommand, { Key: AGENT_IDENTITY_KEY })
      .rejects(noSuchKey());
    s3Mock.on(PutObjectCommand).rejectsOnce(transient500()).resolves({});

    await writeIdentityMdForAgent(mockTx(), AGENT_ID);

    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(2);
  });

  it("bubbles after a second transient S3 PUT failure", async () => {
    queueBase();
    s3Mock
      .on(GetObjectCommand, { Key: AGENT_IDENTITY_KEY })
      .rejects(noSuchKey());
    s3Mock.on(PutObjectCommand).rejects(transient500());

    await expect(writeIdentityMdForAgent(mockTx(), AGENT_ID)).rejects.toThrow();
  });

  it("throws IdentityMdWriterError when the agent isn't resolvable", async () => {
    // Don't queue rows — agent lookup returns empty.
    await expect(
      writeIdentityMdForAgent(mockTx(), AGENT_ID),
    ).rejects.toBeInstanceOf(IdentityMdWriterError);
  });
});
