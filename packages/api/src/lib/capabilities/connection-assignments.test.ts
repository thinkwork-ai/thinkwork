/**
 * Connection-sidecar assignment reads (THINK-190).
 *
 * Contract: the signed `connections/<slug>/.assignment.json` sidecar is
 * the MCP assignment record for flipped agents. Reads are RAW (not the
 * compiled manifest) so disabled/withheld servers still list; non-MCP
 * connections (no `config.registryServerId`) are excluded; fail-soft —
 * null = store unavailable, [] = none.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, listFails } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  listFails: { value: false },
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: () => "workspace-bucket",
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  GetObjectCommand: class {
    constructor(public input: { Bucket: string; Key: string }) {}
  },
  ListObjectsV2Command: class {
    constructor(public input: { Bucket: string; Prefix: string }) {}
  },
}));

const fakeS3 = {
  async send(command: {
    constructor: { name: string };
    input: { Key?: string; Prefix?: string };
  }) {
    if (command.constructor.name === "GetObjectCommand") {
      const body = store.get(command.input.Key!);
      if (body === undefined) {
        throw Object.assign(new Error("no such key"), { name: "NoSuchKey" });
      }
      return { Body: { transformToString: async () => body } };
    }
    // ListObjectsV2Command
    if (listFails.value) throw new Error("S3 down");
    const prefix = command.input.Prefix!;
    return {
      Contents: [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((Key) => ({ Key })),
      IsTruncated: false,
    };
  },
} as never;

import {
  listConnectionAssignments,
  readConnectionAssignment,
} from "./connection-assignments.js";

const PREFIX = "tenants/acme/agents/ada/";
const DEPS = { s3: fakeS3, bucket: "workspace-bucket" };

function sidecar(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    slug: "github",
    class: "connection",
    config: { registryServerId: "srv-1" },
    updated_at: "2026-07-06T00:00:00.000Z",
    ...overrides,
  });
}

beforeEach(() => {
  store.clear();
  listFails.value = false;
});

describe("readConnectionAssignment", () => {
  it("maps registryServerId/enabled/operations from the sidecar", async () => {
    store.set(
      `${PREFIX}connections/github/.assignment.json`,
      sidecar({
        slug: "github",
        permissions: { operations: ["issues_read", "pulls_read"] },
      }),
    );
    const record = await readConnectionAssignment(PREFIX, "github", DEPS);
    expect(record).toEqual({
      slug: "github",
      registryServerId: "srv-1",
      enabled: true,
      operations: ["issues_read", "pulls_read"],
      // Pre-THINK-229 sidecar: no policy block yet (a parity FAIL in the
      // U3 shadow evaluator, but the read itself stays fail-soft).
      policy: null,
      updated_at: "2026-07-06T00:00:00.000Z",
    });
  });

  it("carries enabled:false and defaults operations to []", async () => {
    store.set(
      `${PREFIX}connections/github/.assignment.json`,
      sidecar({ enabled: false }),
    );
    const record = await readConnectionAssignment(PREFIX, "github", DEPS);
    expect(record?.enabled).toBe(false);
    expect(record?.operations).toEqual([]);
  });

  it("excludes non-MCP connections (no registryServerId)", async () => {
    store.set(
      `${PREFIX}connections/api-thing/.assignment.json`,
      sidecar({ slug: "api-thing", config: {} }),
    );
    expect(
      await readConnectionAssignment(PREFIX, "api-thing", DEPS),
    ).toBeNull();
  });

  it("fails soft on absent or malformed sidecars", async () => {
    expect(await readConnectionAssignment(PREFIX, "missing", DEPS)).toBeNull();
    store.set(`${PREFIX}connections/broken/.assignment.json`, "{nope");
    expect(await readConnectionAssignment(PREFIX, "broken", DEPS)).toBeNull();
  });
});

describe("listConnectionAssignments", () => {
  it("lists only MCP-type records, sorted, skipping invalid sidecars", async () => {
    store.set(
      `${PREFIX}connections/linear/.assignment.json`,
      sidecar({ slug: "linear", config: { registryServerId: "srv-2" } }),
    );
    store.set(
      `${PREFIX}connections/github/.assignment.json`,
      sidecar({ slug: "github" }),
    );
    store.set(
      `${PREFIX}connections/api-thing/.assignment.json`,
      sidecar({ slug: "api-thing", config: {} }),
    );
    store.set(`${PREFIX}connections/broken/.assignment.json`, "{nope");
    // Definition files are not sidecars — never listed.
    store.set(`${PREFIX}connections/github/CONNECTION.md`, "---\n---\n");

    const records = await listConnectionAssignments(PREFIX, DEPS);
    expect(records?.map((record) => record.slug)).toEqual(["github", "linear"]);
  });

  it("returns [] when no records exist and null when the store is down", async () => {
    expect(await listConnectionAssignments(PREFIX, DEPS)).toEqual([]);
    listFails.value = true;
    expect(await listConnectionAssignments(PREFIX, DEPS)).toBeNull();
  });
});
