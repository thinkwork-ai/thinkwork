/**
 * Tier-0 mechanical repair (plan 2026-07-03-004 U7, R11/R17): failures
 * self-correct at zero token cost where possible — retry once, revert a
 * freshly promoted SHA, classify infra failures without burning repair
 * budget — and escalate with `needsRepair` only when the mechanical tiers
 * are exhausted on code failures.
 */

import { describe, expect, it, vi } from "vitest";
import { schema } from "@thinkwork/database-pg";
import {
  executeGitRoutine,
  type RoutineExecGitOptions,
} from "../routine-exec-git.js";
import type {
  PythonTaskInput,
  PythonTaskResult,
} from "../routine-task-python.js";

const {
  routines,
  routineExecutions,
  routineCodeCache,
  routineRepairEvents,
  tenantCredentials,
  inboxItems,
} = schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const ROUTINE_ID = "11111111-1111-4111-8111-111111111111";
const VALIDATED_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MARKER = "__THINKWORK_ROUTINE_RESULT__";
const MODULE = "routines/lastmile-check/main.py";
const FIXTURE = "routines/lastmile-check/fixtures/basic.json";
const MODULE_CODE = "def run(input):\n    return {'ok': True, 'count': 3}\n";
const FIXTURE_BASIC = JSON.stringify({
  input: {},
  expected: { ok: true, count: 3 },
  mode: "exact",
});

function fakeDb(state: {
  routines?: Record<string, unknown>[];
  running?: Record<string, unknown>[];
  credentials?: Record<string, unknown>[];
  codeCache?: Record<string, unknown>[];
  inbox?: Record<string, unknown>[];
}) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const updates: { table: unknown; set: Record<string, unknown> }[] = [];
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === routines) return state.routines ?? [];
    if (table === routineExecutions) return state.running ?? [];
    if (table === tenantCredentials) return state.credentials ?? [];
    if (table === routineCodeCache) return state.codeCache ?? [];
    if (table === inboxItems) return state.inbox ?? [];
    return [];
  };
  const db = {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => {
        const result = rowsFor(table);
        const chain = {
          where: () => chain,
          orderBy: () => chain,
          limit: (n: number) => Promise.resolve(result.slice(0, n)),
          then: (resolve: (rows: unknown[]) => void) => resolve(result),
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, set });
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const chain = {
          onConflictDoNothing: () => Promise.resolve([]),
          onConflictDoUpdate: () => Promise.resolve([]),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        };
        return chain;
      },
    }),
  };
  return { db, inserts, updates };
}

function gitRoutineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTINE_ID,
    tenant_id: TENANT,
    name: "LastMile check",
    engine: "git_python",
    status: "active",
    module_path: MODULE,
    fixture_paths: [FIXTURE],
    credential_refs: [],
    validated_sha: VALIDATED_SHA,
    disabled_reason: null,
    ...overrides,
  };
}

function repoCredentialRow() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    tenant_id: TENANT,
    slug: "routine-repo",
    status: "active",
    secret_ref: "arn:secret",
  };
}

function fakeSecrets() {
  return {
    send: vi.fn(async () => ({
      SecretString: JSON.stringify({
        repoUrl: "https://github.com/acme/routines",
        token: "ghp_test",
        branch: "main",
      }),
    })),
  };
}

function fakeS3(objects: Record<string, string> = {}) {
  return {
    send: vi.fn(async (cmd: { input: { Key: string; Body?: string } }) => {
      if (cmd.constructor.name === "GetObjectCommand") {
        const body = objects[cmd.input.Key];
        if (body === undefined) {
          const err = new Error("NoSuchKey") as Error & { name: string };
          err.name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToString: async () => body } };
      }
      objects[cmd.input.Key] = cmd.input.Body ?? "";
      return {};
    }),
  };
}

function fakeOctokit(args: {
  headSha?: string;
  files?: Record<string, string>;
  refError?: Error;
}) {
  return {
    git: {
      getRef: vi.fn(async () => {
        if (args.refError) throw args.refError;
        return { data: { object: { sha: args.headSha } } };
      }),
    },
    repos: {
      getContent: vi.fn(async ({ path }: { path: string }) => {
        const content = args.files?.[path];
        if (content === undefined) {
          throw Object.assign(new Error("Not Found"), { status: 404 });
        }
        return {
          data: {
            content: Buffer.from(content, "utf-8").toString("base64"),
            encoding: "base64",
          },
        };
      }),
    },
  };
}

function okTask(value: unknown): PythonTaskResult {
  return {
    exitCode: 0,
    stdoutS3Uri: null,
    stderrS3Uri: null,
    stdoutPreview: `${MARKER}${JSON.stringify(value)}`,
    truncated: false,
  };
}

function failedTask(message = "Traceback: boom"): PythonTaskResult {
  return {
    exitCode: 1,
    stdoutS3Uri: null,
    stderrS3Uri: null,
    stdoutPreview: message,
    truncated: false,
  };
}

const CACHE_KEY = `routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/${MODULE}`;

function optionsWith(
  overrides: Partial<RoutineExecGitOptions>,
): RoutineExecGitOptions {
  return {
    interpreterId: "interp-1",
    bucket: "bucket",
    secretsManagerClient: fakeSecrets() as never,
    s3Client: fakeS3({ [CACHE_KEY]: MODULE_CODE }) as never,
    octokitFactory: () => fakeOctokit({ headSha: VALIDATED_SHA }) as never,
    now: () => new Date("2026-07-03T12:00:00Z"),
    ...overrides,
  };
}

describe("tier-0 mechanical repair", () => {
  it("recovers a transient failure with one retry and records the retry event", async () => {
    const { db, inserts } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    let calls = 0;
    const pythonTask = vi.fn(async (_input: PythonTaskInput) => {
      calls += 1;
      return calls === 1 ? failedTask("flaky sandbox") : okTask({ ok: true });
    });

    const result = await executeGitRoutine(
      { routineId: ROUTINE_ID },
      optionsWith({ database: db as never, pythonTask }),
    );

    expect(result.status).toBe("succeeded");
    expect(result.retried).toBe(true);
    expect(result.needsRepair).toBeUndefined();
    const retryEvent = inserts.find(
      (i) => i.table === routineRepairEvents && i.values.event_type === "retry",
    );
    expect(retryEvent).toBeDefined();
  });

  it("escalates a deterministic failure on the validated SHA with needsRepair", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const pythonTask = vi.fn(async () => failedTask());

    const result = await executeGitRoutine(
      { routineId: ROUTINE_ID },
      optionsWith({ database: db as never, pythonTask }),
    );

    expect(result.status).toBe("failed");
    expect(result.needsRepair).toBe(true);
    expect(result.revertedToSha).toBeUndefined();
    // Retry happened: two production invocations.
    expect(pythonTask).toHaveBeenCalledTimes(2);
  });

  it("reverts a freshly promoted SHA that fails in production and escalates", async () => {
    const { db, inserts, updates } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    // Gate passes on the new SHA (fixture run green), production run fails.
    const pythonTask = vi.fn(async (input: PythonTaskInput) =>
      input.nodeId === "gate" ? okTask({ ok: true, count: 3 }) : failedTask(),
    );

    const result = await executeGitRoutine(
      { routineId: ROUTINE_ID },
      optionsWith({
        database: db as never,
        pythonTask,
        octokitFactory: () =>
          fakeOctokit({
            headSha: NEW_SHA,
            files: { [MODULE]: MODULE_CODE, [FIXTURE]: FIXTURE_BASIC },
          }) as never,
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.revertedToSha).toBe(VALIDATED_SHA);
    expect(result.needsRepair).toBe(true);
    // validated_sha handed back to the prior SHA.
    const demote = updates.find(
      (u) => u.table === routines && u.set.validated_sha === VALIDATED_SHA,
    );
    expect(demote).toBeDefined();
    // Cache row for the bad SHA marked red.
    const cacheRed = updates.find(
      (u) => u.table === routineCodeCache && u.set.fixture_status === "red",
    );
    expect(cacheRed).toBeDefined();
    const revertEvent = inserts.find(
      (i) =>
        i.table === routineRepairEvents && i.values.event_type === "revert",
    );
    expect(revertEvent?.values).toMatchObject({
      from_sha: NEW_SHA,
      to_sha: VALIDATED_SHA,
    });
  });

  it("classifies a revoked token as infra: operator inbox item, no repair escalation (AE8/R17)", async () => {
    const { db, inserts } = fakeDb({
      routines: [gitRoutineRow({ validated_sha: null })],
      credentials: [], // no active routine-repo credential = revoked/deleted
    });

    const result = await executeGitRoutine(
      { routineId: ROUTINE_ID },
      optionsWith({ database: db as never }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("infra_repo_credential");
    expect(result.needsRepair).toBeUndefined();
    const infraEvent = inserts.find(
      (i) =>
        i.table === routineRepairEvents &&
        i.values.event_type === "infra_failure",
    );
    expect(infraEvent).toBeDefined();
    const inbox = inserts.find((i) => i.table === inboxItems);
    expect(inbox?.values).toMatchObject({
      type: "routine_infra_failure",
      status: "pending",
      entity_id: ROUTINE_ID,
    });
  });

  it("does not duplicate a pending infra inbox item on repeat failures", async () => {
    const { db, inserts } = fakeDb({
      routines: [gitRoutineRow({ validated_sha: null })],
      credentials: [],
      inbox: [{ id: "existing-item", status: "pending" }],
    });

    await executeGitRoutine(
      { routineId: ROUTINE_ID },
      optionsWith({ database: db as never }),
    );

    expect(inserts.filter((i) => i.table === inboxItems)).toHaveLength(0);
    // The repair event is still recorded for the ladder history.
    expect(
      inserts.filter(
        (i) =>
          i.table === routineRepairEvents &&
          i.values.event_type === "infra_failure",
      ),
    ).toHaveLength(1);
  });
});
