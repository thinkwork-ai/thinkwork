/**
 * getThreadCurrentCanvas preference order (THINK-145 seam fix).
 *
 * The current-canvas resolution must prefer a canvas CHECKED OUT into the
 * thread (metadata.checkouts linkage) over a thread-derived draft: a stray
 * draft minted by an accidental new-part-id emission must not steal the
 * save/refresh target from the user's real (checked-out) canvas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";

interface FakeRow {
  id: string;
  title: string | null;
  head_version: number | null;
  status: string | null;
  updated_at: string | null;
  stable_part_id: string | null;
}

const mocks = vi.hoisted(() => ({
  // Result queue: one entry per db.select() call, consumed in order.
  selectResults: [] as FakeRow[][],
  // Serialized predicate text per select call (for containment assertions).
  whereText: [] as string[],
}));

vi.mock("../../graphql/utils.js", () => {
  const table = (name: string, columns: string[]) => {
    const t: Record<string, unknown> = { __table: name };
    for (const column of columns) t[column] = { name: column };
    return t;
  };

  function flattenSql(value: unknown, out: string[]): void {
    if (value == null) return;
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) flattenSql(entry, out);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.queryChunks)) {
        flattenSql(record.queryChunks, out);
      }
      if (typeof record.value === "string") out.push(record.value);
      if (Array.isArray(record.value)) flattenSql(record.value, out);
    }
  }

  function selectBuilder() {
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.where = (predicate: unknown) => {
      const parts: string[] = [];
      flattenSql(predicate, parts);
      mocks.whereText.push(parts.join(" "));
      return builder;
    };
    builder.orderBy = () => builder;
    builder.limit = () => Promise.resolve(mocks.selectResults.shift() ?? []);
    builder.innerJoin = () => builder;
    builder.leftJoin = () => builder;
    return builder;
  }

  return {
    db: { select: () => selectBuilder() },
    artifacts: table("artifacts", [
      "id",
      "tenant_id",
      "thread_id",
      "space_id",
      "title",
      "head_version",
      "status",
      "updated_at",
      "metadata",
    ]),
    spaces: table("spaces", ["id", "name", "status"]),
    spaceMembers: table("space_members", [
      "tenant_id",
      "user_id",
      "space_id",
      "role",
    ]),
    threads: table("threads", ["id", "tenant_id", "space_id"]),
  };
});

import { getThreadCurrentCanvas } from "./saved-canvas-index.js";

function row(id: string, stablePartId: string | null): FakeRow {
  return {
    id,
    title: `Canvas ${id}`,
    head_version: 1,
    status: "final",
    updated_at: "2026-07-04T00:00:00.000Z",
    stable_part_id: stablePartId,
  };
}

beforeEach(() => {
  mocks.selectResults.length = 0;
  mocks.whereText.length = 0;
});

describe("getThreadCurrentCanvas", () => {
  it("prefers a checked-out canvas over a thread-derived draft", async () => {
    // First select = checkout-routed lookup; a hit short-circuits.
    mocks.selectResults.push([row("art-checked-out", "json-render:stable")]);

    const result = await getThreadCurrentCanvas(TENANT_ID, THREAD_ID);

    expect(result?.artifactId).toBe("art-checked-out");
    expect(result?.stablePartId).toBe("json-render:stable");
    // Only the checkout query ran — the draft query was never issued.
    expect(mocks.whereText).toHaveLength(1);
    expect(mocks.whereText[0]).toContain("checkouts");
  });

  it("falls back to the thread-derived canvas when nothing is checked out", async () => {
    mocks.selectResults.push([]); // checkout lookup: no hit
    mocks.selectResults.push([row("art-draft", null)]);

    const result = await getThreadCurrentCanvas(TENANT_ID, THREAD_ID);

    expect(result?.artifactId).toBe("art-draft");
    expect(result?.stablePartId).toBeNull();
    expect(mocks.whereText).toHaveLength(2);
  });

  it("returns null when the thread has no canvas at all", async () => {
    mocks.selectResults.push([]);
    mocks.selectResults.push([]);

    expect(await getThreadCurrentCanvas(TENANT_ID, THREAD_ID)).toBeNull();
  });
});
