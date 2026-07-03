import { describe, expect, it, vi } from "vitest";
import { schema } from "@thinkwork/database-pg";
import {
  checkRepairEnvelope,
  commitRoutine,
  listGitRoutines,
  ROUTINE_AGENT_AUTHOR,
  runRoutineFixtures,
} from "../routine-repo-tools.js";

const {
  routines,
  routineExecutions,
  tenantCredentials,
  tenantMembers,
  inboxItems,
} = schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const ROUTINE_ID = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "44444444-4444-4444-8444-444444444444";
const HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MODULE = "routines/lastmile-check/main.py";
const FIXTURE = "routines/lastmile-check/fixtures/basic.json";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeDb(state: {
  routines?: Record<string, unknown>[];
  executions?: Record<string, unknown>[];
  credentials?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
  repairEvents?: Record<string, unknown>[];
}) {
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === routines) return state.routines ?? [];
    if (table === routineExecutions) return state.executions ?? [];
    if (table === tenantCredentials) return state.credentials ?? [];
    if (table === tenantMembers) return state.members ?? [];
    if (table === schema.routineRepairEvents) return state.repairEvents ?? [];
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const chain = {
          returning: () => Promise.resolve([{ id: "inbox-1" }]),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        };
        return chain;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  return { db, inserts };
}

function gitRoutineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTINE_ID,
    tenant_id: TENANT,
    engine: "git_python",
    name: "LastMile check",
    status: "active",
    module_path: MODULE,
    fixture_paths: [FIXTURE],
    credential_refs: [],
    validated_sha: HEAD_SHA,
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

function operatorRow(role = "admin") {
  return {
    tenant_id: TENANT,
    principal_id: OPERATOR,
    role,
    status: "active",
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

function fakeOctokit(args: {
  headSha?: string;
  files?: Record<string, string>;
}) {
  const created: {
    commits: { message: string; author: { name: string; email: string } }[];
    refsUpdated: { ref: string; force?: boolean }[];
    refsCreated: string[];
  } = { commits: [], refsUpdated: [], refsCreated: [] };
  const octokit = {
    created,
    git: {
      getRef: vi.fn(async () => ({
        data: { object: { sha: args.headSha ?? HEAD_SHA } },
      })),
      getCommit: vi.fn(async () => ({
        data: { tree: { sha: "tree-parent" } },
      })),
      createTree: vi.fn(async () => ({ data: { sha: "tree-new" } })),
      createCommit: vi.fn(
        async (input: {
          message: string;
          author: { name: string; email: string };
        }) => {
          created.commits.push({
            message: input.message,
            author: input.author,
          });
          return { data: { sha: "new-commit-sha" } };
        },
      ),
      updateRef: vi.fn(async (input: { ref: string; force?: boolean }) => {
        created.refsUpdated.push(input);
        return {};
      }),
      createRef: vi.fn(async (input: { ref: string }) => {
        created.refsCreated.push(input.ref);
        return {};
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
  return octokit;
}

const OLD_MODULE_CODE =
  "import requests\n\ndef run(input):\n    data = requests.get('https://api.lastmile.test').json()\n    return {'ok': True, 'count': len(data)}\n";

// ---------------------------------------------------------------------------
// Envelope (R18)
// ---------------------------------------------------------------------------

describe("checkRepairEnvelope", () => {
  it("passes a small code-only fix", () => {
    const fixed = OLD_MODULE_CODE.replace("len(data)", "len(data or [])");
    expect(checkRepairEnvelope(OLD_MODULE_CODE, fixed)).toEqual([]);
  });

  it("flags new imports (AE9)", () => {
    const fixed = "import os\n" + OLD_MODULE_CODE;
    expect(checkRepairEnvelope(OLD_MODULE_CODE, fixed).join(" ")).toMatch(
      /adds imports/,
    );
  });

  it("flags newly introduced network/exec primitives", () => {
    const fixed = OLD_MODULE_CODE + "\n    subprocess_result = 1\n";
    expect(checkRepairEnvelope(OLD_MODULE_CODE, fixed).join(" ")).toMatch(
      /subprocess/,
    );
  });

  it("does not flag primitives the module already used", () => {
    const fixed = OLD_MODULE_CODE.replace(
      "requests.get('https://api.lastmile.test')",
      "requests.get('https://api.lastmile.test', timeout=30)",
    );
    expect(checkRepairEnvelope(OLD_MODULE_CODE, fixed)).toEqual([]);
  });

  it("flags oversized changes", () => {
    const fixed =
      OLD_MODULE_CODE +
      Array.from({ length: 200 }, (_, i) => `    x${i} = ${i}`).join("\n");
    expect(checkRepairEnvelope(OLD_MODULE_CODE, fixed).join(" ")).toMatch(
      /too large/,
    );
  });
});

// ---------------------------------------------------------------------------
// commitRoutine — the composite seam
// ---------------------------------------------------------------------------

function birthInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    principalId: OPERATOR,
    register: {
      name: "LastMile check",
      modulePath: MODULE,
      fixturePaths: [FIXTURE],
      credentialRefs: [],
    },
    files: {
      [MODULE]: OLD_MODULE_CODE,
      [FIXTURE]: JSON.stringify({
        input: {},
        expected: { ok: true },
        mode: "shape",
      }),
    },
    message: "author the LastMile check",
    parentSha: HEAD_SHA,
    ...overrides,
  } as never;
}

describe("commitRoutine", () => {
  it("authors a new routine: commit + registration with fixed author identity (AE6/R15)", async () => {
    const { db, inserts } = fakeDb({
      credentials: [repoCredentialRow()],
      members: [operatorRow()],
    });
    const octokit = fakeOctokit({ headSha: HEAD_SHA });
    const result = await commitRoutine(birthInput(), {
      database: db as never,
      octokitFactory: () => octokit as never,
      secretsManagerClient: fakeSecrets() as never,
    });

    expect(result.status).toBe("committed");
    expect(result.branch).toBe("main");
    expect(octokit.created.commits[0].author).toEqual(ROUTINE_AGENT_AUTHOR);
    expect(octokit.created.commits[0].message).toMatch(
      /^routine\(lastmile-check\): author the LastMile check/,
    );
    // Fast-forward only.
    expect(octokit.created.refsUpdated[0].force).toBe(false);
    // Registration row.
    const registration = inserts.find((i) => i.table === routines);
    expect(registration?.values).toMatchObject({
      tenant_id: TENANT,
      engine: "git_python",
      module_path: MODULE,
      fixture_paths: [FIXTURE],
    });
  });

  it("rejects a new routine without a fixture file (R9)", async () => {
    const { db } = fakeDb({
      credentials: [repoCredentialRow()],
      members: [operatorRow()],
    });
    await expect(
      commitRoutine(
        birthInput({
          register: {
            name: "LastMile check",
            modulePath: MODULE,
            fixturePaths: [],
          },
          files: { [MODULE]: OLD_MODULE_CODE },
        }),
        { database: db as never },
      ),
    ).rejects.toThrow(/fixture/);
  });

  it("rejects birth-path commits from a non-operator (R20)", async () => {
    const { db } = fakeDb({
      credentials: [repoCredentialRow()],
      members: [operatorRow("member")],
    });
    await expect(
      commitRoutine(birthInput(), { database: db as never }),
    ).rejects.toThrow(/not an operator\/admin/);
  });

  it("rejects a stale parent SHA with a conflict, writing nothing", async () => {
    const { db, inserts } = fakeDb({
      credentials: [repoCredentialRow()],
      members: [operatorRow()],
    });
    const octokit = fakeOctokit({ headSha: "b".repeat(40) });
    await expect(
      commitRoutine(birthInput(), {
        database: db as never,
        octokitFactory: () => octokit as never,
        secretsManagerClient: fakeSecrets() as never,
      }),
    ).rejects.toThrow(/conflict/);
    expect(octokit.created.commits).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a repair commit that touches a fixture (AE7/R16)", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
    });
    await expect(
      commitRoutine(
        {
          tenantId: TENANT,
          routineId: ROUTINE_ID,
          files: { [FIXTURE]: "{}" },
          message: "tamper",
          parentSha: HEAD_SHA,
          repair: { executionId: "exec-1" },
        },
        { database: db as never },
      ),
    ).rejects.toThrow(/code only/);
  });

  it("rejects a repair context that does not reference a failed run (R20)", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "succeeded" }],
      credentials: [repoCredentialRow()],
    });
    await expect(
      commitRoutine(
        {
          tenantId: TENANT,
          routineId: ROUTINE_ID,
          files: { [MODULE]: OLD_MODULE_CODE },
          message: "fix",
          parentSha: HEAD_SHA,
          repair: { executionId: "exec-1" },
        },
        { database: db as never },
      ),
    ).rejects.toThrow(/failed execution/);
  });

  it("auto-publishes an in-envelope repair and runs the gate synchronously (R12/R18)", async () => {
    const { db } = fakeDb({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
    });
    const octokit = fakeOctokit({
      headSha: HEAD_SHA,
      files: { [MODULE]: OLD_MODULE_CODE },
    });
    const invokeExecutor = vi.fn(async () => ({
      status: "gate_green" as const,
      gate: { status: "green" as const, sha: "new-commit-sha", fixtures: [] },
    }));
    const result = await commitRoutine(
      {
        tenantId: TENANT,
        routineId: ROUTINE_ID,
        files: {
          [MODULE]: OLD_MODULE_CODE.replace("len(data)", "len(data or [])"),
        },
        message: "guard against null payload",
        parentSha: HEAD_SHA,
        repair: { executionId: "exec-1", threadRef: "thread-9" },
      },
      {
        database: db as never,
        octokitFactory: () => octokit as never,
        secretsManagerClient: fakeSecrets() as never,
        invokeExecutor: invokeExecutor as never,
      },
    );
    expect(result.status).toBe("committed");
    expect(result.branch).toBe("main");
    expect(result.gate?.status).toBe("gate_green");
    expect(invokeExecutor).toHaveBeenCalledWith({
      routineId: ROUTINE_ID,
      mode: "gate",
    });
    expect(octokit.created.commits[0].message).toContain(
      "Repairs-Execution: exec-1",
    );
    expect(octokit.created.commits[0].message).toContain(
      "Repair-Thread: thread-9",
    );
  });

  it("parks an out-of-envelope repair on a pending branch with an approval inbox item (AE9)", async () => {
    const { db, inserts } = fakeDb({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
    });
    const octokit = fakeOctokit({
      headSha: HEAD_SHA,
      files: { [MODULE]: OLD_MODULE_CODE },
    });
    const invokeExecutor = vi.fn();
    const result = await commitRoutine(
      {
        tenantId: TENANT,
        routineId: ROUTINE_ID,
        files: { [MODULE]: "import os\n" + OLD_MODULE_CODE },
        message: "rewrite with os hooks",
        parentSha: HEAD_SHA,
        repair: { executionId: "exec-1" },
      },
      {
        database: db as never,
        octokitFactory: () => octokit as never,
        secretsManagerClient: fakeSecrets() as never,
        invokeExecutor: invokeExecutor as never,
      },
    );
    expect(result.status).toBe("pending_approval");
    expect(result.branch).toMatch(/^thinkwork\/pending\//);
    expect(result.envelopeViolations?.join(" ")).toMatch(/adds imports/);
    // Live branch untouched; commit landed on a new ref.
    expect(octokit.created.refsUpdated).toHaveLength(0);
    expect(octokit.created.refsCreated[0]).toMatch(
      /^refs\/heads\/thinkwork\/pending\//,
    );
    // No auto-publish gate.
    expect(invokeExecutor).not.toHaveBeenCalled();
    // Operator approval inbox item.
    const inbox = inserts.find((i) => i.table === inboxItems);
    expect(inbox?.values).toMatchObject({
      type: "routine_repair_approval",
      status: "pending",
      entity_id: ROUTINE_ID,
    });
  });
});

// ---------------------------------------------------------------------------
// Read primitives
// ---------------------------------------------------------------------------

describe("read primitives", () => {
  it("lists git routines with lifecycle fields", async () => {
    const { db } = fakeDb({ routines: [gitRoutineRow()] });
    const rows = (await listGitRoutines(TENANT, {
      database: db as never,
    })) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      id: ROUTINE_ID,
      enabled: true,
      validatedSha: HEAD_SHA,
      modulePath: MODULE,
    });
  });

  it("dry-runs working files through the executor's gate code path (KTD-5)", async () => {
    const { db } = fakeDb({ routines: [gitRoutineRow()] });
    const invokeExecutor = vi.fn(async () => ({
      status: "gate_green" as const,
    }));
    await runRoutineFixtures(
      {
        tenantId: TENANT,
        routineId: ROUTINE_ID,
        files: { [MODULE]: OLD_MODULE_CODE, [FIXTURE]: "{}" },
      },
      { database: db as never, invokeExecutor: invokeExecutor as never },
    );
    expect(invokeExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "dry_run", routineId: ROUTINE_ID }),
    );
  });
});

// ---------------------------------------------------------------------------
// U8: repair-attempt accounting + budget breaker at the commit seam
// ---------------------------------------------------------------------------

describe("commitRoutine repair budget (U8)", () => {
  const routineRepairEventsTable = schema.routineRepairEvents;

  function repairCommitDeps(state: Parameters<typeof fakeDb>[0]) {
    const { db, inserts } = fakeDb(state);
    const octokit = fakeOctokit({
      headSha: HEAD_SHA,
      files: { [MODULE]: OLD_MODULE_CODE },
    });
    return { db, inserts, octokit };
  }

  function repairCommitInput() {
    return {
      tenantId: TENANT,
      routineId: ROUTINE_ID,
      files: {
        [MODULE]: OLD_MODULE_CODE.replace("len(data)", "len(data or [])"),
      },
      message: "guard against null payload",
      parentSha: HEAD_SHA,
      repair: { executionId: "exec-1", threadRef: "thread-9" },
    };
  }

  it("records a green repair_attempt that consumes no budget (R13)", async () => {
    const { db, inserts, octokit } = repairCommitDeps({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
    });
    await commitRoutine(repairCommitInput(), {
      database: db as never,
      octokitFactory: () => octokit as never,
      secretsManagerClient: fakeSecrets() as never,
      invokeExecutor: vi.fn(async () => ({
        status: "gate_green" as const,
        gate: { status: "green" as const, sha: "new", fixtures: [] },
      })) as never,
    });
    const attempt = inserts.find(
      (i) =>
        i.table === routineRepairEventsTable &&
        i.values.event_type === "repair_attempt",
    );
    expect(attempt?.values).toMatchObject({
      gate_result: "green",
      envelope_verdict: "in_envelope",
      thread_ref: "thread-9",
      budget_snapshot: 3,
    });
  });

  it("counts a red repair_attempt against the budget", async () => {
    const { db, inserts, octokit } = repairCommitDeps({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
    });
    await commitRoutine(repairCommitInput(), {
      database: db as never,
      octokitFactory: () => octokit as never,
      secretsManagerClient: fakeSecrets() as never,
      invokeExecutor: vi.fn(async () => ({
        status: "gate_red" as const,
        gate: { status: "red" as const, sha: "new", fixtures: [] },
      })) as never,
    });
    const attempt = inserts.find(
      (i) =>
        i.table === routineRepairEventsTable &&
        i.values.event_type === "repair_attempt",
    );
    expect(attempt?.values).toMatchObject({
      gate_result: "red",
      budget_snapshot: 2,
    });
    // Budget not exhausted — no disable.
    expect(
      inserts.find(
        (i) =>
          i.table === routineRepairEventsTable &&
          i.values.event_type === "disabled",
      ),
    ).toBeUndefined();
  });

  it("disables the routine on the third red attempt of the UTC day (AE4)", async () => {
    const priorRed = (n: number) => ({
      id: `evt-${n}`,
      event_type: "repair_attempt",
      gate_result: "red",
      created_at: new Date("2026-07-03T0" + n + ":00:00Z"),
    });
    const { db, inserts, octokit } = repairCommitDeps({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
      repairEvents: [priorRed(1), priorRed(2)],
    });
    await commitRoutine(repairCommitInput(), {
      database: db as never,
      octokitFactory: () => octokit as never,
      secretsManagerClient: fakeSecrets() as never,
      invokeExecutor: vi.fn(async () => ({
        status: "gate_red" as const,
        gate: { status: "red" as const, sha: "new", fixtures: [] },
      })) as never,
    });
    const disabled = inserts.find(
      (i) =>
        i.table === routineRepairEventsTable &&
        i.values.event_type === "disabled",
    );
    expect(disabled).toBeDefined();
    const inbox = inserts.find(
      (i) =>
        i.table === inboxItems &&
        (i.values.type as string) === "routine_repair_budget_exhausted",
    );
    expect(inbox).toBeDefined();
  });

  it("records a pending_commit event that consumes no attempt (AE9)", async () => {
    const { db, inserts, octokit } = repairCommitDeps({
      routines: [gitRoutineRow()],
      executions: [{ id: "exec-1", status: "failed" }],
      credentials: [repoCredentialRow()],
    });
    await commitRoutine(
      {
        ...repairCommitInput(),
        files: { [MODULE]: "import os\n" + OLD_MODULE_CODE },
      },
      {
        database: db as never,
        octokitFactory: () => octokit as never,
        secretsManagerClient: fakeSecrets() as never,
        invokeExecutor: vi.fn() as never,
      },
    );
    const pending = inserts.find(
      (i) =>
        i.table === routineRepairEventsTable &&
        i.values.event_type === "pending_commit",
    );
    expect(pending?.values).toMatchObject({
      envelope_verdict: "out_of_envelope",
    });
    expect(
      inserts.find(
        (i) =>
          i.table === routineRepairEventsTable &&
          i.values.event_type === "repair_attempt",
      ),
    ).toBeUndefined();
  });
});
