/**
 * eval-runner dataset dispatch tests (Evaluations Trust Core U6).
 *
 * The dispatcher path under test: a run with dataset_id captures the
 * launch-time snapshot (copy-at-launch, sha-verified), pins
 * dataset_version + pinned_case_ids + total_tests on the run row, and
 * fans out SQS messages carrying the run-scoped S3 key + expected sha.
 * Legacy category launches keep flowing through the pre-U6 path
 * (covered by eval-runner.test.ts + eval-worker-integration.test.ts).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  evalDatasets,
  evalRuns,
  evalTestCases,
  tenants,
} from "@thinkwork/database-pg/schema";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  computeEvalCaseSha,
  evalDatasetCaseKey,
  evalDatasetManifestKey,
  evalRunSnapshotCaseKey,
  isEvalRunSnapshotKeyForRun,
  serializeEvalDatasetCase,
  serializeEvalDatasetManifest,
  type DatasetStorage,
  type EvalDatasetCaseCore,
  type EvalDatasetManifest,
} from "../lib/evals/dataset-store.js";

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  const lazyDb = new Proxy(
    {},
    {
      get(_target, prop) {
        return (fakeDb as Record<PropertyKey, unknown>)[prop];
      },
    },
  );
  return { ...actual, getDb: () => lazyDb };
});

vi.mock("../lib/eval-notify.js", () => ({
  notifyEvalRunUpdate: vi.fn(async () => {}),
}));

vi.mock("../lib/agents/tenant-platform-agent.js", () => ({
  resolveTenantPlatformAgent: vi.fn(async () => ({ id: "agent-1" })),
}));

import {
  _setDatasetStorageForTests,
  _setSqsClientForTests,
  handler,
  type EvalWorkerMessage,
} from "./eval-runner.js";
import { notifyEvalRunUpdate } from "../lib/eval-notify.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeDbState {
  run: Record<string, unknown>;
  dataset: Record<string, unknown> | null;
  tenant: Record<string, unknown> | null;
  caseRows: Array<Record<string, unknown>>;
  runUpdates: Array<Record<string, any>>;
}

let state: FakeDbState;
let fakeDb: any;

function createFakeDb(dbState: FakeDbState) {
  const select = () => ({
    from: (table: unknown) => ({
      where: async () => {
        if (table === evalRuns) return [dbState.run];
        if (table === evalDatasets)
          return dbState.dataset ? [dbState.dataset] : [];
        if (table === tenants) return dbState.tenant ? [dbState.tenant] : [];
        if (table === evalTestCases) return dbState.caseRows;
        return [];
      },
    }),
  });
  const update = () => ({
    set: (set: Record<string, any>) => {
      dbState.runUpdates.push(set);
      const where = () =>
        Object.assign(Promise.resolve([{ id: dbState.run.id }]), {
          returning: async () => [{ ...dbState.run, ...set }],
        });
      return { where };
    },
  });
  return { select, update };
}

interface MemoryStorage extends DatasetStorage {
  objects: Map<string, string>;
}

function makeMemoryStorage(): MemoryStorage {
  const objects = new Map<string, string>();
  return {
    objects,
    async read(key) {
      return objects.has(key) ? (objects.get(key) as string) : null;
    },
    async write(key, content) {
      objects.set(key, content);
    },
    async delete(key) {
      objects.delete(key);
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const sentBatches: Array<{ Entries: Array<{ MessageBody: string }> }> = [];
const fakeSqs = {
  send: vi.fn(async (cmd: { input: any }) => {
    sentBatches.push(cmd.input);
    return {};
  }),
} as never;

function makeCore(
  caseId: string,
  overrides: Partial<EvalDatasetCaseCore> = {},
): EvalDatasetCaseCore {
  return {
    case_id: caseId,
    name: caseId,
    category: "red-team",
    query: `query for ${caseId}`,
    system_prompt: null,
    expected_behavior: null,
    assertions: [{ type: "icontains", value: "refuse" }],
    tags: [],
    enabled: true,
    ...overrides,
  };
}

function seedDataset(
  storage: MemoryStorage,
  cases: EvalDatasetCaseCore[],
  version = 7,
): EvalDatasetManifest {
  const manifest: EvalDatasetManifest = {
    slug: "baseline-red-team",
    name: "Baseline Red Team",
    kind: "baseline",
    version,
    updated_at: new Date().toISOString(),
    archived_at: null,
    cases: [],
    tombstones: [],
  };
  for (const core of cases) {
    const content = serializeEvalDatasetCase(core, {
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
    storage.objects.set(
      evalDatasetCaseKey("acme", "baseline-red-team", core.case_id),
      content,
    );
    manifest.cases.push({
      case_id: core.case_id,
      content_sha: computeEvalCaseSha(content),
    });
  }
  storage.objects.set(
    evalDatasetManifestKey("acme", "baseline-red-team"),
    serializeEvalDatasetManifest(manifest),
  );
  return manifest;
}

let storage: MemoryStorage;

beforeEach(() => {
  vi.clearAllMocks();
  sentBatches.length = 0;
  process.env.EVAL_FANOUT_QUEUE_URL = "https://sqs.test/eval-fanout.fifo";
  storage = makeMemoryStorage();
  _setDatasetStorageForTests(storage);
  _setSqsClientForTests(fakeSqs);
  state = {
    run: {
      id: "run-1",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      computer_id: null,
      scheduled_job_id: null,
      status: "pending",
      execution_target: "agentcore",
      runtime_host: "aws-agentcore",
      model: null,
      categories: [],
      selected_test_case_ids: [],
      dataset_id: "ds-1",
      dataset_version: null,
      pinned_case_ids: null,
      total_tests: 0,
      scoring_version: CURRENT_EVAL_SCORING_VERSION,
      started_at: null,
    },
    dataset: { slug: "baseline-red-team" },
    tenant: { slug: "acme" },
    caseRows: [
      { id: "uuid-a", dataset_case_id: "case-a" },
      { id: "uuid-b", dataset_case_id: "case-b" },
    ],
    runUpdates: [],
  };
  fakeDb = createFakeDb(state);
});

afterEach(() => {
  _setDatasetStorageForTests(undefined);
  _setSqsClientForTests(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("eval-runner dataset dispatch (U6)", () => {
  it("pins version + case ids, copies content, and fans out snapshot-keyed messages", async () => {
    seedDataset(storage, [makeCore("case-a"), makeCore("case-b")]);

    const result = await handler({ runId: "run-1" });

    expect(result).toEqual({
      ok: true,
      runId: "run-1",
      dispatched: 2,
      totalTests: 2,
    });

    // The run row pinned the launch-time scope.
    const running = state.runUpdates.at(-1)!;
    expect(running.status).toBe("running");
    expect(running.dataset_version).toBe(7);
    expect(running.pinned_case_ids).toEqual(["case-a", "case-b"]);
    expect(running.selected_test_case_ids).toEqual(["uuid-a", "uuid-b"]);
    expect(running.total_tests).toBe(2);

    // Copies landed under the run snapshot prefix.
    expect(
      storage.objects.has(evalRunSnapshotCaseKey("acme", "run-1", "case-a")),
    ).toBe(true);
    expect(
      storage.objects.has(evalRunSnapshotCaseKey("acme", "run-1", "case-b")),
    ).toBe(true);

    // SQS messages carry the run-scoped key + expected sha — small body,
    // workers fetch the copy.
    const messages: EvalWorkerMessage[] = sentBatches.flatMap((b) =>
      b.Entries.map((e) => JSON.parse(e.MessageBody)),
    );
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message.runId).toBe("run-1");
      expect(["uuid-a", "uuid-b"]).toContain(message.testCaseId);
      expect(
        isEvalRunSnapshotKeyForRun(message.snapshotKey!, "acme", "run-1"),
      ).toBe(true);
      expect(message.contentSha).toMatch(/^[0-9a-f]{64}$/);
      expect(
        computeEvalCaseSha(storage.objects.get(message.snapshotKey!) as string),
      ).toBe(message.contentSha);
    }
    expect(vi.mocked(notifyEvalRunUpdate)).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        status: "running",
        totalTests: 2,
      }),
    );
  });

  it("total_tests equals the effective pinned scope, not the raw case count", async () => {
    seedDataset(storage, [
      makeCore("case-a"),
      makeCore("case-disabled", { enabled: false }),
    ]);
    state.caseRows = [{ id: "uuid-a", dataset_case_id: "case-a" }];

    const result = await handler({ runId: "run-1" });

    expect(result.dispatched).toBe(1);
    const running = state.runUpdates.at(-1)!;
    expect(running.total_tests).toBe(1);
    expect(running.pinned_case_ids).toEqual(["case-a"]);
    // The disabled case was never copied.
    expect(
      storage.objects.has(
        evalRunSnapshotCaseKey("acme", "run-1", "case-disabled"),
      ),
    ).toBe(false);
  });

  it("zero enabled cases completes the run with a null pass rate and pinned scope", async () => {
    seedDataset(storage, [makeCore("case-a", { enabled: false })]);
    state.caseRows = [];

    const result = await handler({ runId: "run-1" });

    expect(result).toEqual({
      ok: true,
      runId: "run-1",
      dispatched: 0,
      totalTests: 0,
    });
    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.status).toBe("completed");
    expect(finalize.pass_rate).toBeNull();
    expect(finalize.dataset_version).toBe(7);
    expect(finalize.pinned_case_ids).toEqual([]);
    expect(sentBatches).toHaveLength(0);
  });

  it("fails the run with an error_message when the snapshot capture stays torn", async () => {
    const manifest = seedDataset(storage, [makeCore("case-a")]);
    // Permanently torn: object disagrees with the manifest sha.
    storage.objects.set(
      evalDatasetCaseKey("acme", "baseline-red-team", "case-a"),
      serializeEvalDatasetCase(makeCore("case-a", { query: "torn" }), null),
    );
    expect(manifest.cases[0].content_sha).not.toBe(
      computeEvalCaseSha(
        storage.objects.get(
          evalDatasetCaseKey("acme", "baseline-red-team", "case-a"),
        ) as string,
      ),
    );

    const result = await handler({ runId: "run-1" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/never pins torn content/);
    const failed = state.runUpdates.at(-1)!;
    expect(failed.status).toBe("failed");
    expect(failed.error_message).toMatch(/never pins torn content/);
    expect(sentBatches).toHaveLength(0);
  });

  it("fails the launch when a pinned case has no index row (no partial fan-out)", async () => {
    seedDataset(storage, [makeCore("case-a"), makeCore("case-b")]);
    state.caseRows = [{ id: "uuid-a", dataset_case_id: "case-a" }];

    const result = await handler({ runId: "run-1" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/index rows missing.*case-b/);
    expect(sentBatches).toHaveLength(0);
  });
});
