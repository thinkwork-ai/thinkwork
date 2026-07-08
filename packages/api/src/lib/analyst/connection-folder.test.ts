/**
 * Analyst connection folder materialization tests (THINK-228 U5).
 *
 * Integration-level per the plan: folder-write mechanics (signing
 * internals) are covered upstream in folder-write.test.ts — here we
 * assert composition: both files land under connections/postgres-dev/,
 * the sidecar is enabled + signed, and re-materializing with a changed
 * SCHEMA.md updates the workspace copy and re-signs the definition.
 */

import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, selectQueue } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain: {
        from: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
        limit: ReturnType<typeof vi.fn>;
        then: (
          resolve: (v: unknown[]) => void,
          reject: (e: unknown) => void,
        ) => void;
      } = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
        then: (resolve, reject) =>
          Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
      };
      return chain;
    }),
  };
  return { mockDb, selectQueue };
});

vi.mock("../../graphql/utils.js", () => ({ db: mockDb }));
vi.mock("../skills/assignment-state.js", () => ({
  resolveAgentWorkspacePrefix: vi.fn(async (agentId: string) =>
    agentId === "agent-no-prefix" ? null : `tenants/acme/agents/${agentId}/`,
  ),
}));

import { capabilitySignerFromKey } from "../capabilities/sidecar-signing.js";
import {
  ANALYST_CONNECTION_GUIDANCE,
  analystConnectionDefinition,
  materializeAnalystConnectionFolder,
} from "./connection-folder.js";

const { privateKey } = generateKeyPairSync("ed25519");
const signer = capabilitySignerFromKey(privateKey);

function fakeS3() {
  const objects = new Map<string, string>();
  return {
    objects,
    send: vi.fn(async (command: { input: { Key?: string; Body?: string } }) => {
      objects.set(String(command.input.Key), String(command.input.Body));
      return {};
    }),
  };
}

const ROW = {
  id: "server-1",
  slug: "postgres-dev",
  name: "Postgres (dev)",
  url: "https://api.dev.example.com/mcp/analyst",
  transport: "streamable-http",
  tools: null,
  status: "approved",
};
const TENANT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  selectQueue.length = 0;
});

describe("analyst connection folder (U5)", () => {
  it("CONNECTION.md references SCHEMA.md by relative path", () => {
    const { slug, definition } = analystConnectionDefinition(ROW);
    expect(slug).toBe("postgres-dev");
    expect(definition).toContain("[SCHEMA.md](./SCHEMA.md)");
    expect(definition).toContain(ANALYST_CONNECTION_GUIDANCE.trim());
    // Refs only — no auth material of any kind.
    expect(definition).not.toMatch(/secret|token|password/i);
  });

  it("materializes CONNECTION.md + signed .assignment.json + SCHEMA.md per agent", async () => {
    const s3 = fakeS3();
    selectQueue.push([ROW]); // registry row
    selectQueue.push([{ id: "agent-1" }, { id: "agent-2" }]); // tenant agents

    const result = await materializeAnalystConnectionFolder({
      tenantId: TENANT,
      tenantMcpServerId: ROW.id,
      schemaMarkdown: "# ThinkWork dev Postgres — semantic model\n",
      db: mockDb as never,
      deps: { s3: s3 as never, bucket: "bucket", signer },
    });

    expect(result.agents).toBe(2);
    expect(result.skipped).toEqual([]);
    for (const agent of ["agent-1", "agent-2"]) {
      const base = `tenants/acme/agents/${agent}/connections/postgres-dev/`;
      expect(s3.objects.get(`${base}CONNECTION.md`)).toContain(
        "[SCHEMA.md](./SCHEMA.md)",
      );
      expect(s3.objects.get(`${base}SCHEMA.md`)).toContain("semantic model");
      const sidecar = JSON.parse(s3.objects.get(`${base}.assignment.json`)!);
      expect(sidecar.enabled).toBe(true);
      expect(sidecar.permissions).toEqual({ operations: ["run_query"] });
      expect(sidecar.config).toEqual({ registryServerId: ROW.id });
      expect(sidecar.signature.signed_by).toBe(
        "operator:provision-analyst-connector",
      );
      expect(sidecar.signed_content_sha).toBeTypeOf("string");
    }
  });

  it("regenerated SCHEMA.md updates the workspace copy and busts the signature", async () => {
    const s3 = fakeS3();
    selectQueue.push([ROW], [{ id: "agent-1" }]);
    await materializeAnalystConnectionFolder({
      tenantId: TENANT,
      tenantMcpServerId: ROW.id,
      schemaMarkdown: "v1 schema\n",
      db: mockDb as never,
      deps: { s3: s3 as never, bucket: "bucket", signer },
    });
    const base = "tenants/acme/agents/agent-1/connections/postgres-dev/";
    const firstSidecar = JSON.parse(s3.objects.get(`${base}.assignment.json`)!);

    selectQueue.push([ROW], [{ id: "agent-1" }]);
    await materializeAnalystConnectionFolder({
      tenantId: TENANT,
      tenantMcpServerId: ROW.id,
      schemaMarkdown: "v2 schema — new table\n",
      db: mockDb as never,
      deps: { s3: s3 as never, bucket: "bucket", signer },
    });
    expect(s3.objects.get(`${base}SCHEMA.md`)).toContain("v2 schema");
    // The sidecar re-signs on every materialization — the sidecar key is
    // written once per run (the workspace render then picks up the changed
    // folder bytes, busting the capability input signature).
    const sidecarWrites = s3.send.mock.calls.filter(
      (call) =>
        (call[0] as { input: { Key?: string } }).input.Key ===
        `${base}.assignment.json`,
    );
    expect(sidecarWrites).toHaveLength(2);
    expect(firstSidecar.enabled).toBe(true);
  });

  it("fails loudly on non-approved rows and prefix-less agents", async () => {
    selectQueue.push([{ ...ROW, status: "pending" }]);
    await expect(
      materializeAnalystConnectionFolder({
        tenantId: TENANT,
        tenantMcpServerId: ROW.id,
        schemaMarkdown: "x",
        db: mockDb as never,
        deps: { s3: fakeS3() as never, bucket: "bucket", signer },
      }),
    ).rejects.toThrow(/pending, not approved/);

    selectQueue.push([ROW], [{ id: "agent-no-prefix" }]);
    await expect(
      materializeAnalystConnectionFolder({
        tenantId: TENANT,
        tenantMcpServerId: ROW.id,
        schemaMarkdown: "x",
        db: mockDb as never,
        deps: { s3: fakeS3() as never, bucket: "bucket", signer },
      }),
    ).rejects.toThrow(/no agent workspace was written/);
  });
});
