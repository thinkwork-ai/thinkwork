/**
 * commitRoutineBundle tests (THINK-280 U6): the single Routine-bundle
 * publisher. Atomic multi-file commit with the expected-head lock; stale
 * head returns a reviewable conflict (exactly one of two racing promotions
 * commits); the promoted SHA is gated hermetically.
 */

import { describe, expect, it, vi } from "vitest";
import { schema } from "@thinkwork/database-pg";
import {
  commitRoutineBundle,
  type CommitRoutineBundleInput,
} from "../routine-repo-tools.js";
import type { RoutineExecGitResult } from "../routine-exec-git.js";

const { tenantCredentials, routines } = schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function fakeDb() {
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === tenantCredentials
            ? [
                {
                  id: "c1",
                  tenant_id: TENANT,
                  slug: "routine-repo",
                  status: "active",
                  secret_ref: "arn:secret",
                },
              ]
            : [];
        const chain = {
          where: () => chain,
          orderBy: () => chain,
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          then: (r: (x: unknown[]) => void) => r(rows),
        };
        return chain;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: () => Promise.resolve([{ id: "x" }]),
          then: (r: (x: unknown[]) => void) => r([]),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return { db, inserted, updated };
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

function fakeOctokit(headSha = HEAD) {
  const commits: { message: string; files: string[] }[] = [];
  const refsUpdated: { force?: boolean }[] = [];
  let treeFiles: string[] = [];
  const octokit = {
    commits,
    refsUpdated,
    git: {
      getRef: vi.fn(async () => ({ data: { object: { sha: headSha } } })),
      getCommit: vi.fn(async () => ({
        data: { tree: { sha: "tree-parent" } },
      })),
      createTree: vi.fn(async ({ tree }: { tree: { path: string }[] }) => {
        treeFiles = tree.map((t) => t.path);
        return { data: { sha: "tree-new" } };
      }),
      createCommit: vi.fn(async ({ message }: { message: string }) => {
        commits.push({ message, files: treeFiles });
        return { data: { sha: "promoted-sha" } };
      }),
      updateRef: vi.fn(async (input: { force?: boolean }) => {
        refsUpdated.push(input);
        return {};
      }),
      createRef: vi.fn(async () => ({})),
    },
    repos: {
      getContent: vi.fn(async () => {
        throw Object.assign(new Error("nf"), { status: 404 });
      }),
    },
  };
  return octokit;
}

function bundleInput(
  overrides: Partial<CommitRoutineBundleInput> = {},
): CommitRoutineBundleInput {
  return {
    tenantId: TENANT,
    slug: "issue-health",
    displayName: "Issue Health",
    code: "def run(input):\n    return {'ok': True}\n",
    fixtures: [{ input: { n: 1 }, expected: { ok: true } }],
    invariants: [],
    dependencies: [
      {
        twcap: "twcap://acme/connection/github/repos.get",
        contractHash: "a".repeat(64),
        definitionVersionId: "dv1",
      },
    ],
    principal: { mode: "service", subjectId: "sp1" },
    provenance: { evidence: {} },
    approvedFingerprint: "f".repeat(64),
    parentSha: HEAD,
    ...overrides,
  };
}

const greenGate: RoutineExecGitResult = {
  status: "gate_green",
  validatedSha: "promoted-sha",
  gate: {
    status: "green",
    sha: "promoted-sha",
    fixtures: [
      {
        path: "routines/issue-health/fixtures/00.json",
        mode: "exact",
        passed: true,
      },
    ],
  },
};

describe("commitRoutineBundle", () => {
  it("writes the full bundle in one commit and gates the promoted SHA", async () => {
    const { db, inserted } = fakeDb();
    const octokit = fakeOctokit();
    const invokeExecutor = vi.fn(async () => greenGate);
    const res = await commitRoutineBundle(bundleInput(), {
      database: db as never,
      octokitFactory: () => octokit as never,
      secretsManagerClient: fakeSecrets() as never,
      invokeExecutor,
    });

    expect(res.status).toBe("committed");
    expect(res.commitSha).toBe("promoted-sha");
    expect(res.validatedSha).toBe("promoted-sha");
    // One atomic commit, fast-forward (never force).
    expect(octokit.commits.length).toBe(1);
    expect(octokit.refsUpdated[0].force).toBe(false);
    // Bundle contains every required file.
    const files = octokit.commits[0].files;
    expect(files).toContain("routines/issue-health/main.py");
    expect(files).toContain("routines/issue-health/dependencies.json");
    expect(files).toContain("routines/issue-health/invariants.json");
    expect(files).toContain("routines/issue-health/provenance.json");
    expect(files).toContain("routines/issue-health/fixtures/00.json");
    // A new git_python routine row was created with pinned deps + principal.
    const routineInsert = inserted.find((i) => i.table === routines);
    expect(routineInsert!.values.engine).toBe("git_python");
    expect(routineInsert!.values.capability_dependencies).toEqual(
      bundleInput().dependencies,
    );
    // The gate pinned the capability dependencies onto the cache row.
    expect(invokeExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "gate",
        sha: "promoted-sha",
        capabilityDependencies: bundleInput().dependencies,
      }),
    );
  });

  it("returns a reviewable conflict when the branch head moved (stale-head race)", async () => {
    const { db } = fakeDb();
    const octokit = fakeOctokit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const invokeExecutor = vi.fn(async () => greenGate);
    const res = await commitRoutineBundle(bundleInput({ parentSha: HEAD }), {
      database: db as never,
      octokitFactory: () => octokit as never,
      secretsManagerClient: fakeSecrets() as never,
      invokeExecutor,
    });
    expect(res.status).toBe("conflict");
    expect(res.headSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(octokit.commits.length).toBe(0); // no partial commit
    expect(invokeExecutor).not.toHaveBeenCalled();
  });
});
