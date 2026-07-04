/**
 * End-to-end-shaped round-trip (Living Artifacts THINK-145 U8, AE3 + R13).
 *
 * Drives the REAL checkoutCanvas + born-as-artifact upsert + saveCanvas against
 * a single stateful in-memory `db` + S3 mock, so "same artifact, version N+1, no
 * duplicate row" is a state assertion — not a call-order assertion. Only the
 * leaf infra (drizzle ops, S3, space-access gate, materialization) is mocked;
 * the routing + version-chain logic under test runs for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  stableStringify,
  threadJsonRenderStateSnapshotPayload,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SPACE_ID = "88888888-8888-8888-8888-888888888888";
const ARTIFACT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_2 = "22222222-0000-0000-0000-000000000002";
const THREAD_3 = "33333333-0000-0000-0000-000000000003";
const THREAD_9 = "99999999-0000-0000-0000-000000000009";

// -------- stateful store (hoisted so the vi.mock factory can reference it) --
type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const ART = "artifacts";
  const THR = "threads";
  const VER = "artifact_versions";
  const store = {
    artifacts: new Map<string, Row>(),
    threads: new Map<string, Row>(),
    versions: [] as Row[],
    s3: new Map<string, string>(),
  };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const rowsOf = (table: string): Row[] => {
    if (table === ART) return [...store.artifacts.values()];
    if (table === THR) return [...store.threads.values()];
    if (table === VER) return store.versions;
    return [];
  };
  const matchRow = (row: Row, cond: any): boolean => {
    if (!cond) return true;
    if (cond.and) return cond.and.every((c: any) => matchRow(row, c));
    if (cond.eq) {
      const [field, value] = cond.eq;
      return (row as any)[field.__col] === value;
    }
    if (cond.sql !== undefined) {
      const s: string = cond.sql;
      const strVal = cond.values.find(
        (v: unknown) => typeof v === "string",
      ) as string | undefined;
      if (s.includes("stablePartId")) {
        return (row.metadata as any)?.stablePartId === strVal;
      }
      if (s.includes("checkouts") && s.includes("@>")) {
        const arr = JSON.parse(strVal ?? "[]");
        const tid = arr[0]?.threadId;
        const list = (row.metadata as any)?.checkouts;
        return Array.isArray(list) && list.some((c: any) => c.threadId === tid);
      }
      return true;
    }
    return true;
  };
  const applyPatch = (row: Row, patch: Record<string, any>): void => {
    for (const [key, val] of Object.entries(patch)) {
      if (val && typeof val === "object" && val.sql !== undefined) {
        if (key === "head_write_seq") {
          row.head_write_seq = ((row.head_write_seq as number) ?? 0) + 1;
        } else if (key === "metadata") {
          const s: string = val.sql;
          if (s.includes("jsonb_set")) {
            const entryStr = val.values.find(
              (v: unknown) => typeof v === "string" && v.trim().startsWith("["),
            );
            const entry = JSON.parse(entryStr);
            const tid = entry[0].threadId;
            const existing = Array.isArray((row.metadata as any)?.checkouts)
              ? (row.metadata as any).checkouts
              : [];
            row.metadata = {
              ...((row.metadata as object) ?? {}),
              checkouts: [
                ...existing.filter((c: any) => c.threadId !== tid),
                ...entry,
              ],
            };
          } else if (s.includes("||")) {
            const objStr = val.values.find(
              (v: unknown) => typeof v === "string" && v.trim().startsWith("{"),
            );
            row.metadata = {
              ...((row.metadata as object) ?? {}),
              ...JSON.parse(objStr),
            };
          }
        }
        continue;
      }
      (row as any)[key] = val;
    }
  };
  return { ART, THR, VER, store, clone, rowsOf, matchRow, applyPatch };
});

const store = h.store;

vi.mock("../../utils.js", () => {
  const { ART, THR, VER, store, clone, rowsOf, matchRow, applyPatch } = h;
  const nameOf = (table: any): string => table?.__table ?? "";
  const selectFrom = (tableRef: any) => {
    const table = nameOf(tableRef);
    return {
      where: (cond: any) => {
        const matched = rowsOf(table)
          .filter((r) => matchRow(r, cond))
          .map(clone);
        const result: any = {
          then: (res: (v: Row[]) => void) => res(matched),
          limit: (n: number) => Promise.resolve(matched.slice(0, n)),
          orderBy: () => ({
            then: (res: (v: Row[]) => void) => res(matched),
            limit: (n: number) => Promise.resolve(matched.slice(0, n)),
          }),
        };
        return result;
      },
    };
  };
  return {
    and: (...conditions: unknown[]) => ({ and: conditions }),
    eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
    desc: (f: unknown) => ({ desc: f }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
    randomUUID: () => "rnd-" + Math.random().toString(16).slice(2),
    artifacts: {
      __table: ART,
      id: { __col: "id" },
      tenant_id: { __col: "tenant_id" },
      status: { __col: "status" },
      head_write_seq: { __col: "head_write_seq" },
      metadata: { __col: "metadata" },
    },
    artifactVersions: { __table: VER, id: { __col: "id" } },
    threads: {
      __table: THR,
      id: { __col: "id" },
      tenant_id: { __col: "tenant_id" },
      space_id: { __col: "space_id" },
      agent_id: { __col: "agent_id" },
    },
    threadTurns: { __table: "thread_turns" },
    messages: { __table: "messages" },
    db: {
      select: () => ({ from: (t: any) => selectFrom(t) }),
      update: (tableRef: any) => {
        const table = nameOf(tableRef);
        let patch: Record<string, any> = {};
        let cached: Row[] | null = null;
        const apply = (cond: any) => {
          if (cached) return cached;
          const targets = rowsOf(table).filter((r) => matchRow(r, cond));
          targets.forEach((r) => applyPatch(r, patch));
          cached = targets.map(clone);
          return cached;
        };
        const builder: any = {
          set: (p: Record<string, any>) => {
            patch = p;
            return builder;
          },
          where: (cond: any) => ({
            then: (res: (v: Row[]) => void) => res(apply(cond)),
            returning: () => Promise.resolve(apply(cond)),
          }),
        };
        return builder;
      },
      insert: (tableRef: any) => ({
        values: (row: Row) => ({
          then: (res: (v: undefined) => void) => {
            if (nameOf(tableRef) === VER) store.versions.push(clone(row));
            res(undefined);
          },
          onConflictDoUpdate: (cfg: any) => {
            const existing = store.artifacts.get(row.id as string);
            if (!existing) {
              store.artifacts.set(row.id as string, clone(row));
            } else if ((existing.status as string) === "draft") {
              applyPatch(existing, cfg.set);
            }
            return Promise.resolve(undefined);
          },
        }),
      }),
    },
  };
});

vi.mock("../../../lib/artifacts/payload-storage.js", () => ({
  artifactContentKey: ({
    tenantId,
    artifactId,
    revision,
  }: {
    tenantId: string;
    artifactId: string;
    revision?: string;
  }) =>
    revision
      ? `tenants/${tenantId}/art/${artifactId}/content/${revision}.md`
      : `tenants/${tenantId}/art/${artifactId}/content.md`,
  isArtifactPayloadS3Key: () => true,
  readArtifactPayloadFromS3: ({ key }: { key: string }) =>
    Promise.resolve(store.s3.get(key) ?? "{}"),
  writeArtifactPayloadToS3: ({ key, body }: { key: string; body: string }) => {
    store.s3.set(key, body);
    return Promise.resolve(undefined);
  },
}));

vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  CANVAS_LIVING_KIND: "json_render_canvas",
  assertCanvasAccess: vi.fn(() => Promise.resolve()),
  hasSpaceWriteRole: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../lib/artifacts/canvas-materialize.js", () => ({
  materializeCanvasIntoThread: vi.fn(() =>
    Promise.resolve({ messageId: "m", eventSeq: null }),
  ),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: vi.fn(() => Promise.resolve("member")),
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: vi.fn(() =>
    Promise.resolve({ userId: USER_ID, tenantId: TENANT_ID }),
  ),
}));
vi.mock("./payload.js", () => ({
  artifactToCamelWithPayload: (row: Row) => ({
    id: row?.id,
    status: row?.status,
    headVersion: row?.head_version,
    spaceId: row?.space_id,
  }),
}));

import { checkoutCanvas } from "./checkoutCanvas.mutation.js";
import { saveCanvas } from "./saveCanvas.mutation.js";
import { upsertDraftCanvasFromActivityEvent } from "../../../lib/artifacts/born-artifact.js";

const ctx = { auth: { authType: "cognito" } } as never;

/** A valid re-emitted part (same stable id, different content). */
function editedPart(base: ThreadJsonRenderPart, summary: string): ThreadJsonRenderPart {
  return {
    ...base,
    data: {
      ...base.data,
      mobileFallback: { ...base.data.mobileFallback, summary },
    },
  };
}

function seedSavedCanvas(part: ThreadJsonRenderPart, headVersion: number) {
  const headKey = `tenants/${TENANT_ID}/art/${ARTIFACT_A}/content.md`;
  store.s3.set(headKey, stableStringify(part));
  store.artifacts.set(ARTIFACT_A, {
    id: ARTIFACT_A,
    tenant_id: TENANT_ID,
    type: "data_view",
    status: "final",
    content: null,
    s3_key: headKey,
    head_version: headVersion,
    head_write_seq: headVersion,
    space_id: SPACE_ID,
    agent_id: null,
    title: "Cost dashboard",
    summary: "seed",
    metadata: { kind: "json_render_canvas", stablePartId: part.id },
  });
}

function seedThread(id: string, spaceId = SPACE_ID) {
  store.threads.set(id, {
    id,
    tenant_id: TENANT_ID,
    space_id: spaceId,
    agent_id: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.artifacts.clear();
  store.threads.clear();
  store.versions.length = 0;
  store.s3.clear();
});

describe("checkout → re-emit → re-save round-trip (AE3)", () => {
  it("edits a checked-out canvas and re-saving appends version N+1 to the SAME artifact (no new row)", async () => {
    const base = createTaskReviewJsonRenderFixture();
    seedSavedCanvas(base, 3);
    seedThread(THREAD_2);

    // 1) Check out A into T2 (same space).
    await checkoutCanvas({}, { artifactId: ARTIFACT_A, threadId: THREAD_2 }, ctx);
    // Linkage recorded, no new artifact.
    expect(store.artifacts.size).toBe(1);
    expect((store.artifacts.get(ARTIFACT_A)!.metadata as any).checkouts).toEqual([
      expect.objectContaining({ threadId: THREAD_2 }),
    ]);

    // 2) Agent edits the canvas — re-emits the part in T2.
    const edited = editedPart(base, "edited numbers");
    const routed = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_2,
      agentId: null,
      payload: threadJsonRenderStateSnapshotPayload(edited),
    });
    // Routed to the ORIGINAL artifact; still exactly one artifact.
    expect(routed).toEqual({ artifactId: ARTIFACT_A });
    expect(store.artifacts.size).toBe(1);
    // Head content is the edited part; head_write_seq bumped (KTD6).
    const headKey = store.artifacts.get(ARTIFACT_A)!.s3_key as string;
    expect(store.s3.get(headKey)).toBe(stableStringify(edited));
    expect(store.artifacts.get(ARTIFACT_A)!.head_write_seq).toBe(4);

    // 3) Re-save from T2 → auto-pin the (edited) head as version 4.
    const saved: any = await saveCanvas(
      {},
      { artifactId: ARTIFACT_A, title: "Cost dashboard", spaceId: SPACE_ID },
      ctx,
    );

    expect(store.artifacts.size).toBe(1); // no duplicate artifact row
    expect(saved.headVersion).toBe(4);
    expect(store.versions).toHaveLength(1);
    expect(store.versions[0]).toMatchObject({
      artifact_id: ARTIFACT_A,
      version: 4,
    });
  });

  it("an unrelated thread emitting the same stable id WITHOUT a checkout mints its own artifact (collision safety)", async () => {
    const base = createTaskReviewJsonRenderFixture();
    seedSavedCanvas(base, 3);
    seedThread(THREAD_9);

    await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_9,
      agentId: null,
      payload: threadJsonRenderStateSnapshotPayload(base),
    });

    // A second artifact was minted; the original was never touched.
    expect(store.artifacts.size).toBe(2);
    expect(store.artifacts.get(ARTIFACT_A)!.head_write_seq).toBe(3);
  });

  it("two threads check out the same canvas; each re-save auto-pins a version (no silent loss)", async () => {
    const base = createTaskReviewJsonRenderFixture();
    seedSavedCanvas(base, 3);
    seedThread(THREAD_2);
    seedThread(THREAD_3);

    await checkoutCanvas({}, { artifactId: ARTIFACT_A, threadId: THREAD_2 }, ctx);
    await checkoutCanvas({}, { artifactId: ARTIFACT_A, threadId: THREAD_3 }, ctx);
    // Both checkouts recorded on the one artifact.
    expect(store.artifacts.size).toBe(1);
    expect(
      (store.artifacts.get(ARTIFACT_A)!.metadata as any).checkouts,
    ).toHaveLength(2);

    // T2 edits + re-saves → version 4.
    await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_2,
      agentId: null,
      payload: threadJsonRenderStateSnapshotPayload(editedPart(base, "from T2")),
    });
    await saveCanvas(
      {},
      { artifactId: ARTIFACT_A, title: "T2", spaceId: SPACE_ID },
      ctx,
    );

    // T3 edits + re-saves → version 5 (serialized on head_write_seq; T2's state
    // survives as version 4 — no silent loss).
    await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_3,
      agentId: null,
      payload: threadJsonRenderStateSnapshotPayload(editedPart(base, "from T3")),
    });
    await saveCanvas(
      {},
      { artifactId: ARTIFACT_A, title: "T3", spaceId: SPACE_ID },
      ctx,
    );

    expect(store.artifacts.size).toBe(1);
    expect(store.versions.map((v) => v.version).sort()).toEqual([4, 5]);
  });
});
