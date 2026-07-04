import { describe, expect, it, vi } from "vitest";
import { schema } from "@thinkwork/database-pg";
import {
  deepEqual,
  executeGitRoutine,
  matchesShape,
  GATE_INPUT_KEY,
  type RoutineExecGitInput,
  type RoutineExecGitOptions,
} from "../routine-exec-git.js";
import type {
  PythonTaskInput,
  PythonTaskResult,
} from "../routine-task-python.js";

const { routines, routineExecutions, routineCodeCache, tenantCredentials } =
  schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const ROUTINE_ID = "11111111-1111-4111-8111-111111111111";
const VALIDATED_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const MARKER = "__THINKWORK_ROUTINE_RESULT__";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeDbState {
  routines: Record<string, unknown>[];
  runningExecutions: Record<string, unknown>[];
  credentials: Record<string, unknown>[];
  codeCache: Record<string, unknown>[];
  inserts: { table: unknown; values: Record<string, unknown> }[];
  updates: { table: unknown; set: Record<string, unknown> }[];
}

function fakeDb(state: Partial<FakeDbState>) {
  const s: FakeDbState = {
    routines: [],
    runningExecutions: [],
    credentials: [],
    codeCache: [],
    inserts: [],
    updates: [],
    ...state,
  };
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === routines) return s.routines;
    if (table === routineExecutions) return s.runningExecutions;
    if (table === tenantCredentials) return s.credentials;
    if (table === routineCodeCache) return s.codeCache;
    return [];
  };
  const db = {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => {
        const result = rowsFor(table);
        const thenable = {
          where: () => thenable,
          limit: (n: number) => Promise.resolve(result.slice(0, n)),
          then: (resolve: (rows: unknown[]) => void) => resolve(result),
        };
        return thenable;
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          s.updates.push({ table, set });
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        s.inserts.push({ table, values });
        const chain = {
          onConflictDoNothing: () => Promise.resolve([]),
          onConflictDoUpdate: () => Promise.resolve([]),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        };
        return chain;
      },
    }),
  };
  return { db, state: s };
}

function gitRoutineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTINE_ID,
    tenant_id: TENANT,
    engine: "git_python",
    status: "active",
    module_path: "routines/lastmile-check/main.py",
    fixture_paths: ["routines/lastmile-check/fixtures/basic.json"],
    credential_refs: [{ alias: "lastmile", credentialId: "lastmile-api" }],
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
    kind: "github_repo",
    status: "active",
    secret_ref: "arn:aws:secretsmanager:secret",
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

/** In-memory S3: objects keyed by `bucket/key`. */
function fakeS3(objects: Record<string, string> = {}) {
  const puts: string[] = [];
  return {
    puts,
    objects,
    client: {
      send: vi.fn(async (cmd: { input: { Key: string; Body?: string } }) => {
        const name = cmd.constructor.name;
        const key = cmd.input.Key;
        if (name === "GetObjectCommand") {
          const body = objects[key];
          if (body === undefined) {
            const err = new Error("NoSuchKey") as Error & { name: string };
            err.name = "NoSuchKey";
            throw err;
          }
          return { Body: { transformToString: async () => body } };
        }
        // PutObjectCommand
        objects[key] = cmd.input.Body ?? "";
        puts.push(key);
        return {};
      }),
    },
  };
}

function fakeOctokit(args: {
  headSha?: string | null;
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

function okTask(resultValue: unknown): PythonTaskResult {
  return {
    exitCode: 0,
    stdoutS3Uri: null,
    stderrS3Uri: null,
    stdoutPreview: `${MARKER}${JSON.stringify(resultValue)}`,
    truncated: false,
  };
}

const MODULE_CODE = "def run(input):\n    return {'ok': True, 'count': 3}\n";
const FIXTURE_BASIC = JSON.stringify({
  input: { window: "1d" },
  expected: { ok: true, count: 3 },
  mode: "exact",
});

function baseOptions(overrides: Partial<RoutineExecGitOptions> = {}) {
  const s3 = fakeS3();
  return {
    s3,
    options: {
      interpreterId: "interp-1",
      bucket: "bucket",
      s3Client: s3.client as never,
      secretsManagerClient: fakeSecrets() as never,
      pythonTask: vi.fn(async () => okTask({ ok: true, count: 3 })),
      now: () => new Date("2026-07-03T12:00:00Z"),
      ...overrides,
    } satisfies RoutineExecGitOptions,
  };
}

function exec(input: Partial<RoutineExecGitInput> = {}) {
  return { routineId: ROUTINE_ID, triggerSource: "manual", ...input };
}

// ---------------------------------------------------------------------------
// Comparison primitives (KTD-6)
// ---------------------------------------------------------------------------

describe("fixture comparison", () => {
  it("deepEqual demands exact values", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("matchesShape passes when values change but structure holds", () => {
    expect(
      matchesShape(
        { dispatches: [{ id: "d1", status: "ok" }], total: 2 },
        { dispatches: [{ id: "d9", status: "late", extra: 1 }], total: 41 },
      ),
    ).toBe(true);
  });

  it("matchesShape fails when a named field disappears or changes type", () => {
    expect(matchesShape({ total: 2 }, { count: 2 })).toBe(false);
    expect(matchesShape({ total: 2 }, { total: "2" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Execution paths
// ---------------------------------------------------------------------------

describe("executeGitRoutine", () => {
  it("executes a validated SHA from the S3 cache and records commit_sha", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    const pythonTask = vi.fn(async () => okTask({ ok: true, count: 3 }));
    const result = await executeGitRoutine(exec(), {
      interpreterId: "interp-1",
      bucket: "bucket",
      database: db as never,
      s3Client: s3.client as never,
      secretsManagerClient: fakeSecrets() as never,
      octokitFactory: () => fakeOctokit({ headSha: VALIDATED_SHA }) as never,
      pythonTask,
    });

    expect(result.status).toBe("succeeded");
    expect(result.commitSha).toBe(VALIDATED_SHA);
    expect(result.outputJson).toEqual({ ok: true, count: 3 });
    // Ledger: one running insert + one terminal update.
    const runInsert = state.inserts.find((i) => i.table === routineExecutions);
    expect(runInsert?.values.commit_sha).toBe(VALIDATED_SHA);
    expect(runInsert?.values.cache_served).toBe(false);
    const terminal = state.updates.find(
      (u) => u.table === routineExecutions && u.set.status === "succeeded",
    );
    expect(terminal?.set.output_json).toEqual({ ok: true, count: 3 });
    // No GitHub content fetch — cache hit.
    expect(pythonTask).toHaveBeenCalledTimes(1);
  });

  it("gates a moved HEAD before use and promotes validated_sha on green", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3();
    const pythonTask = vi.fn(async (_input: PythonTaskInput) =>
      okTask({ ok: true, count: 3 }),
    );
    const result = await executeGitRoutine(exec(), {
      interpreterId: "interp-1",
      bucket: "bucket",
      database: db as never,
      s3Client: s3.client as never,
      secretsManagerClient: fakeSecrets() as never,
      octokitFactory: () =>
        fakeOctokit({
          headSha: NEW_SHA,
          files: {
            "routines/lastmile-check/main.py": MODULE_CODE,
            "routines/lastmile-check/fixtures/basic.json": FIXTURE_BASIC,
          },
        }) as never,
      pythonTask,
    });

    expect(result.status).toBe("succeeded");
    expect(result.commitSha).toBe(NEW_SHA);
    expect(result.gate?.status).toBe("green");
    // validated_sha promoted by the gate (its only writer).
    const promote = state.updates.find(
      (u) => u.table === routines && u.set.validated_sha === NEW_SHA,
    );
    expect(promote).toBeDefined();
    // Gate run passed _gate: true; production run did not.
    const gateCall = pythonTask.mock.calls.find((c) => c[0].nodeId === "gate");
    const prodCall = pythonTask.mock.calls.find((c) => c[0].nodeId === "run");
    expect(
      (gateCall![0].input as Record<string, unknown>)[GATE_INPUT_KEY],
    ).toBe(true);
    expect(
      (prodCall![0].input as Record<string, unknown>)?.[GATE_INPUT_KEY],
    ).toBeUndefined();
  });

  it("runs the last-validated SHA when the new SHA gates red", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    // Gate run returns a wrong value → exact fixture mismatch → red.
    const pythonTask = vi.fn(async (input: PythonTaskInput) =>
      input.nodeId === "gate"
        ? okTask({ ok: false, count: 0 })
        : okTask({ ok: true, count: 3 }),
    );
    const result = await executeGitRoutine(exec(), {
      interpreterId: "interp-1",
      bucket: "bucket",
      database: db as never,
      s3Client: s3.client as never,
      secretsManagerClient: fakeSecrets() as never,
      octokitFactory: () =>
        fakeOctokit({
          headSha: NEW_SHA,
          files: {
            "routines/lastmile-check/main.py":
              "def run(input):\n    return {'ok': False}\n",
            "routines/lastmile-check/fixtures/basic.json": FIXTURE_BASIC,
          },
        }) as never,
      pythonTask,
    });

    expect(result.status).toBe("succeeded");
    expect(result.commitSha).toBe(VALIDATED_SHA);
    expect(result.gate?.status).toBe("red");
    // No validated_sha promotion happened.
    expect(
      state.updates.find(
        (u) => u.table === routines && u.set.validated_sha === NEW_SHA,
      ),
    ).toBeUndefined();
  });

  it("serves the cached validated SHA when git is unreachable (AE5)", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    const result = await executeGitRoutine(exec(), {
      interpreterId: "interp-1",
      bucket: "bucket",
      database: db as never,
      s3Client: s3.client as never,
      secretsManagerClient: fakeSecrets() as never,
      octokitFactory: () =>
        fakeOctokit({
          refError: Object.assign(new Error("connect ETIMEDOUT"), {
            status: 500,
          }),
        }) as never,
      pythonTask: vi.fn(async () => okTask({ ok: true, count: 3 })),
    });

    expect(result.status).toBe("succeeded");
    expect(result.cacheServed).toBe(true);
    const runInsert = state.inserts.find((i) => i.table === routineExecutions);
    expect(runInsert?.values.cache_served).toBe(true);
  });

  it("classifies git-unreachable with no fallback as infra (no repair budget)", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow({ validated_sha: null })],
      credentials: [repoCredentialRow()],
    });
    const result = await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
      octokitFactory: () =>
        fakeOctokit({
          refError: Object.assign(new Error("boom"), { status: 500 }),
        }) as never,
    });
    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("infra_git_unreachable");
    const failedInsert = state.inserts.find(
      (i) => i.table === routineExecutions,
    );
    expect(failedInsert?.values.error_code).toBe("infra_git_unreachable");
  });

  it("classifies a revoked token as infra_repo_credential (AE8 seam)", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [],
    });
    const result = await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
    });
    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("infra_repo_credential");
  });

  it("serializes per routine — a live running row skips the invocation", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      runningExecutions: [{ id: "live-1", status: "running" }],
      credentials: [repoCredentialRow()],
    });
    const result = await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
    });
    expect(result.status).toBe("skipped_already_running");
    expect(result.executionId).toBe("live-1");
  });

  it("sweeps stale running rows before checking serialization", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      // Post-sweep view: no live rows remain.
      runningExecutions: [],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
      s3Client: s3.client as never,
      octokitFactory: () => fakeOctokit({ headSha: VALIDATED_SHA }) as never,
    });
    const sweep = state.updates.find(
      (u) =>
        u.table === routineExecutions &&
        u.set.error_code === "stale_running_swept",
    );
    expect(sweep).toBeDefined();
    expect(sweep?.set.status).toBe("timed_out");
  });

  it("injects only the routine's declared credential refs (AE10)", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    const pythonTask = vi.fn(async (_input: PythonTaskInput) =>
      okTask({ ok: true }),
    );
    await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
      s3Client: s3.client as never,
      octokitFactory: () => fakeOctokit({ headSha: VALIDATED_SHA }) as never,
      pythonTask,
    });
    const call = pythonTask.mock.calls[0][0];
    expect(call.credentialBindings).toEqual([
      { alias: "lastmile", credentialId: "lastmile-api" },
    ]);
    // No env allowlist leakage: the executor passes an empty allowlist.
  });

  it("blocks a new SHA with zero fixtures (R9) and falls back", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow({ fixture_paths: [] })],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    const result = await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
      s3Client: s3.client as never,
      octokitFactory: () =>
        fakeOctokit({
          headSha: NEW_SHA,
          files: { "routines/lastmile-check/main.py": MODULE_CODE },
        }) as never,
    });
    expect(result.gate?.status).toBe("red");
    expect(result.gate?.errorClass).toBe("no_fixtures");
    expect(result.commitSha).toBe(VALIDATED_SHA);
  });

  it("fails safe on a malformed fixture file", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const result = await executeGitRoutine(exec({ mode: "gate" }), {
      ...baseOptions().options,
      database: db as never,
      octokitFactory: () =>
        fakeOctokit({
          headSha: NEW_SHA,
          files: {
            "routines/lastmile-check/main.py": MODULE_CODE,
            "routines/lastmile-check/fixtures/basic.json": "{not json",
          },
        }) as never,
    });
    expect(result.status).toBe("gate_red");
    expect(result.gate?.fixtures[0].detail).toMatch(/malformed/);
  });

  it("gates inline working files in dry_run without touching the ledger", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const pythonTask = vi.fn(async () => okTask({ ok: true, count: 3 }));
    const result = await executeGitRoutine(
      exec({
        mode: "dry_run",
        modulePath: "routines/lastmile-check/main.py",
        files: {
          "routines/lastmile-check/main.py": MODULE_CODE,
          "routines/lastmile-check/fixtures/basic.json": FIXTURE_BASIC,
        },
      }),
      {
        ...baseOptions().options,
        database: db as never,
        pythonTask,
      },
    );
    expect(result.status).toBe("gate_green");
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it("marks a nonzero-exit run failed with error detail", async () => {
    const { db, state } = fakeDb({
      routines: [gitRoutineRow()],
      credentials: [repoCredentialRow()],
    });
    const s3 = fakeS3({
      [`routine-code-cache/${TENANT}/${ROUTINE_ID}/${VALIDATED_SHA}/routines/lastmile-check/main.py`]:
        MODULE_CODE,
    });
    const result = await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
      s3Client: s3.client as never,
      octokitFactory: () => fakeOctokit({ headSha: VALIDATED_SHA }) as never,
      pythonTask: vi.fn(async () => ({
        exitCode: 1,
        stdoutS3Uri: null,
        stderrS3Uri: null,
        stdoutPreview: "Traceback ...",
        truncated: false,
      })),
    });
    expect(result.status).toBe("failed");
    const terminal = state.updates.find(
      (u) => u.table === routineExecutions && u.set.status === "failed",
    );
    expect(terminal?.set.error_code).toBe("code_run_failed");
  });

  it("refuses non-git_python routines", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow({ engine: "step_functions" })],
    });
    const result = await executeGitRoutine(exec(), {
      ...baseOptions().options,
      database: db as never,
    });
    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("infra_wrong_engine");
  });
});
