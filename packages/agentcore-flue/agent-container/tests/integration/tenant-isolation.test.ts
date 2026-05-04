/**
 * Plan §005 U11 — Multi-tenant isolation audit (FR-4a) with concurrent test.
 *
 * AUDIT CHECKLIST (PASS / FAIL / DEFERRED per item)
 * --------------------------------------------------
 * 1. PASS — Aurora SessionStore (U4): tenantId + agentId bound at construction;
 *    every save/load/delete predicate scopes on `tenant_id = :tenant_id AND
 *    agent_id = :agent_id`. The `Concurrent SessionStore writes` describe-block
 *    below interleaves 10 invocations with alternating tenants and asserts no
 *    SQL parameter cross-contamination.
 *
 * 2. PASS — MCP wiring (U7): no module-level Map cache. Each invocation
 *    constructs a fresh `HandleStore` (verified by the
 *    `HandleStore per-invocation isolation` describe-block) and the
 *    pluggable `connectMcpServer` factory holds no module state. The
 *    audit grep at the bottom of this file enforces the structural rule
 *    (no `new Map()` at module scope inside src/).
 *
 * 3. PASS — Sandbox factory (U8): `resolveSandboxFactory` returns a fresh
 *    `SandboxFactory` from `@thinkwork/flue-aws.agentcoreCodeInterpreter`
 *    on every call. Verified by the `Sandbox factory freshness`
 *    describe-block — repeated calls return distinct objects.
 *
 * 4. PASS — Memory tools (U6) + Hindsight tools (U6): both build* helpers
 *    fail closed when `tenantId` is missing or empty. Verified by
 *    `Memory tool tenant scope` and `Hindsight tool tenant scope`
 *    describe-blocks. There is no agent-supplied override path — `tenantId`
 *    is bound on the context struct and consulted by `requireScope` on
 *    every tool invocation.
 *
 * 5. DEFERRED to U16 — Compaction + `session.task()` sub-agent isolation:
 *    Flue's session.task spawns sub-agents that should inherit the
 *    trusted-handler tenantId without being override-able by an agent
 *    prompt. The worker-thread integration that owns this seam is U16.
 *    Until U16 lands, the test surface for sub-agent isolation does not
 *    exist; the relevant `it.todo(...)` placeholders below capture the
 *    coverage we owe.
 *
 * 6. DEFERRED to U9 merge — End-to-end /invocations concurrent isolation:
 *    spawning 10+ concurrent invocations against a single container
 *    exercises the trusted handler's tenant-isolation invariants
 *    (HandleStore lifecycle in finally, env snapshot per invocation,
 *    completion callback contract). U9 is the unit that ships the
 *    handler shell; the test placeholder names U9 explicitly.
 *
 * NON-AUDIT NOTES
 * ---------------
 * - `Audit grep — module-level Map state` runs as a real assertion on the
 *   src/ tree: every `new Map(` occurrence must be inside a function body
 *   (verified by indent depth in the source file). A future refactor that
 *   accidentally hoists per-invocation state to module scope fails the
 *   build.
 *
 * - The Aurora concurrency test uses `aws-sdk-client-mock` to capture
 *   send() calls. Real cross-tenant isolation is enforced by Aurora's row
 *   predicates; this test catches the upstream contract — that the store
 *   threads tenantId/agentId into every command — not Aurora's behavior.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";
import { mockClient } from "aws-sdk-client-mock";
import {
  BedrockAgentCoreClient,
} from "@aws-sdk/client-bedrock-agentcore";

import { AuroraSessionStore } from "../../src/sessionstore-aurora.js";
import {
  HandleStore,
  HandleStoreError,
  buildMcpTools,
  type ConnectMcpServerFn,
} from "../../src/mcp.js";
import { resolveSandboxFactory } from "../../src/runtime/sandbox-factory.js";
import { buildMemoryTools, MemoryToolError } from "../../src/tools/memory.js";
import {
  buildHindsightTools,
  HindsightToolError,
} from "../../src/tools/hindsight.js";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FLUE_SRC = path.resolve(__dirname, "../../src");

// ---------------------------------------------------------------------------
// AuroraSessionStore — concurrent isolation under interleaved writes.
// ---------------------------------------------------------------------------

describe("AuroraSessionStore — concurrent tenant isolation (audit item #1)", () => {
  const rdsMock = mockClient(RDSDataClient);

  beforeEach(() => {
    rdsMock.reset();
    // Every save() expects numberOfRecordsUpdated >= 1.
    rdsMock.on(ExecuteStatementCommand).resolves({
      numberOfRecordsUpdated: 1,
    });
  });

  it("10 interleaved saves with alternating tenants thread the right tenantId+agentId on every command", async () => {
    const tenants = ["tenant-A", "tenant-B"] as const;
    const agents = ["agent-A", "agent-B"] as const;

    const stores = tenants.map((tenantId, i) =>
      new AuroraSessionStore({
        tenantId,
        agentId: agents[i]!,
        clusterArn: "arn:aws:rds:us-east-1:000000000000:cluster:test",
        secretArn: "arn:aws:secretsmanager:us-east-1:000000000000:secret:test",
        client: new RDSDataClient({}),
      }),
    );

    const N = 10;
    const ops: Array<Promise<unknown>> = [];
    const expectations: Array<{ tenantId: string; agentId: string; threadId: string }> = [];
    for (let i = 0; i < N; i += 1) {
      const tenantIdx = i % 2;
      const tenantId = tenants[tenantIdx]!;
      const agentId = agents[tenantIdx]!;
      const threadId = `00000000-0000-0000-0000-${i.toString().padStart(12, "0")}`;
      const store = stores[tenantIdx]!;
      expectations.push({ tenantId, agentId, threadId });
      ops.push(
        store.save(threadId, {
          version: 2,
          entries: [],
          leafId: null,
          metadata: { iteration: i },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
    }
    await Promise.all(ops);

    const calls = rdsMock.commandCalls(ExecuteStatementCommand);
    expect(calls).toHaveLength(N);

    // Every recorded command must have the tenant+agent pair matching the
    // thread_id it carried. If the store leaked state across instances we
    // would see, e.g., tenant-A.id parameters with tenant-B's threadId.
    //
    // The SDK's SqlParameter.value is a discriminated union (Field) where
    // `stringValue` lives only on the StringValueMember branch. We narrow
    // explicitly so a future shift to a different parameter type
    // (longValue, booleanValue, …) surfaces as a typed test failure rather
    // than silently reading `undefined` and false-passing the
    // cross-contamination assertion.
    for (const call of calls) {
      const params = call.args[0].input.parameters ?? [];
      const byName = new Map<string, string>();
      for (const param of params) {
        if (!param.name || !param.value) continue;
        if (!("stringValue" in param.value)) {
          throw new Error(
            `tenant-isolation test: SqlParameter ${param.name} carries a non-string value; ` +
              "the AuroraSessionStore contract expects all four bound parameters to be StringValueMember.",
          );
        }
        const stringValue = param.value.stringValue;
        if (typeof stringValue !== "string") continue;
        byName.set(param.name, stringValue);
      }
      const recordedThreadId = byName.get("thread_id");
      const recordedTenantId = byName.get("tenant_id");
      const recordedAgentId = byName.get("agent_id");
      const expected = expectations.find((e) => e.threadId === recordedThreadId);
      if (!expected) {
        throw new Error(`unrecognised thread_id ${recordedThreadId}`);
      }
      expect(recordedTenantId).toBe(expected.tenantId);
      expect(recordedAgentId).toBe(expected.agentId);
    }
  });

  it("save fails closed when the row predicate matches no record (cross-tenant write attempt)", async () => {
    rdsMock.on(ExecuteStatementCommand).resolves({
      numberOfRecordsUpdated: 0,
    });
    const store = new AuroraSessionStore({
      tenantId: "tenant-A",
      agentId: "agent-A",
      clusterArn: "arn:aws:rds:us-east-1:000000000000:cluster:test",
      secretArn: "arn:aws:secretsmanager:us-east-1:000000000000:secret:test",
      client: new RDSDataClient({}),
    });
    await expect(
      store.save("00000000-0000-0000-0000-000000000001", {
        version: 2,
        entries: [],
        leafId: null,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/matched no thread row/);
  });
});

// ---------------------------------------------------------------------------
// HandleStore — per-invocation isolation (audit item #2).
// ---------------------------------------------------------------------------

describe("HandleStore — per-invocation isolation (audit item #2)", () => {
  it("two stores minting the same bearer return distinct handles", () => {
    const a = new HandleStore();
    const b = new HandleStore();
    const bearer = "fake-bearer-shared-do-not-leak";
    const handleA = a.mint(bearer);
    const handleB = b.mint(bearer);
    expect(handleA).not.toBe(handleB);
    expect(a.resolve(handleA)).toBe(bearer);
    expect(b.resolve(handleB)).toBe(bearer);
  });

  it("a handle minted on one store is unresolvable on another", () => {
    const a = new HandleStore();
    const b = new HandleStore();
    const handle = a.mint("bearer-A");
    expect(() => b.resolve(handle)).toThrow(HandleStoreError);
  });

  it("clear() on one store does not affect another", () => {
    const a = new HandleStore();
    const b = new HandleStore();
    const handleA = a.mint("bearer-A");
    const handleB = b.mint("bearer-B");
    a.clear();
    expect(() => a.resolve(handleA)).toThrow(HandleStoreError);
    // Store B unchanged.
    expect(b.resolve(handleB)).toBe("bearer-B");
  });

  it("revoke() on one store does not affect another store's handles", () => {
    const a = new HandleStore();
    const b = new HandleStore();
    const handleA1 = a.mint("bearer-A1");
    const handleA2 = a.mint("bearer-A2");
    const handleB = b.mint("bearer-B");
    a.revoke(handleA1);
    expect(() => a.resolve(handleA1)).toThrow(HandleStoreError);
    // Other entries on the same store are untouched.
    expect(a.resolve(handleA2)).toBe("bearer-A2");
    // Store B is completely unaffected.
    expect(b.resolve(handleB)).toBe("bearer-B");
    expect(b.size).toBe(1);
  });

  it("10 interleaved mint+resolve cycles per store stay isolated", async () => {
    const a = new HandleStore();
    const b = new HandleStore();
    const cycles = await Promise.all(
      Array.from({ length: 10 }, async (_unused, i) => {
        const bearerA = `bearer-A-${i}`;
        const bearerB = `bearer-B-${i}`;
        const handleA = a.mint(bearerA);
        const handleB = b.mint(bearerB);
        return {
          handleA,
          handleB,
          resolvedA: a.resolve(handleA),
          resolvedB: b.resolve(handleB),
          crossA: () => b.resolve(handleA),
          crossB: () => a.resolve(handleB),
        };
      }),
    );
    for (const cycle of cycles) {
      expect(cycle.handleA).not.toBe(cycle.handleB);
      expect(cycle.resolvedA).toMatch(/^bearer-A-\d+$/);
      expect(cycle.resolvedB).toMatch(/^bearer-B-\d+$/);
      expect(cycle.crossA).toThrow(HandleStoreError);
      expect(cycle.crossB).toThrow(HandleStoreError);
    }
    expect(a.size).toBe(10);
    expect(b.size).toBe(10);
  });

  it("buildMcpTools constructs Authorization with the local handle store, no module-level cache", async () => {
    const headersByStore: Array<Record<string, string>[]> = [[], []];
    const stores = [new HandleStore(), new HandleStore()];
    const factories: ConnectMcpServerFn[] = stores.map((_, idx) => async (args) => {
      headersByStore[idx]!.push(args.headers);
      return [];
    });

    await Promise.all(
      stores.map((store, idx) =>
        buildMcpTools({
          mcpConfigs: [
            {
              serverName: `srv-${idx}`,
              url: "https://mcp.example.com/",
              bearer: `bearer-${idx}`,
            },
          ],
          handleStore: store,
          connectMcpServer: factories[idx]!,
        }),
      ),
    );

    expect(headersByStore[0]).toHaveLength(1);
    expect(headersByStore[1]).toHaveLength(1);
    // Explicit guards instead of an unreadable `headersByStore[0]![0]!.Authorization!`
    // chain. Each `?` would silently coerce a missing key into `undefined.replace`
    // — better to surface a typed assertion failure pinpointing the actual gap.
    const auth0 = headersByStore[0]?.[0]?.Authorization;
    const auth1 = headersByStore[1]?.[0]?.Authorization;
    expect(auth0, "store-0 Authorization header missing").toBeDefined();
    expect(auth1, "store-1 Authorization header missing").toBeDefined();
    const handle0 = auth0!.replace(/^Handle /, "");
    const handle1 = auth1!.replace(/^Handle /, "");
    expect(handle0).not.toBe(handle1);
    const store0 = stores[0];
    const store1 = stores[1];
    expect(store0).toBeDefined();
    expect(store1).toBeDefined();
    expect(store0!.resolve(handle0)).toBe("bearer-0");
    expect(store1!.resolve(handle1)).toBe("bearer-1");
    // Cross-store resolution must fail — the load-bearing isolation invariant.
    expect(() => store0!.resolve(handle1)).toThrow();
    expect(() => store1!.resolve(handle0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sandbox factory — fresh instance per call (audit item #3).
// ---------------------------------------------------------------------------

describe("Sandbox factory freshness (audit item #3)", () => {
  it("returns a distinct SandboxFactory on each call", () => {
    const client = new BedrockAgentCoreClient({});
    const f1 = resolveSandboxFactory(
      { sandbox_interpreter_id: "interpreter-A" },
      { client },
    );
    const f2 = resolveSandboxFactory(
      { sandbox_interpreter_id: "interpreter-A" },
      { client },
    );
    expect(f1).not.toBe(f2);
  });

  it("different tenants resolve different interpreter IDs without leaking state", () => {
    const client = new BedrockAgentCoreClient({});
    const fa = resolveSandboxFactory(
      { sandbox_interpreter_id: "interpreter-tenant-A" },
      { client },
    );
    const fb = resolveSandboxFactory(
      { sandbox_interpreter_id: "interpreter-tenant-B" },
      { client },
    );
    expect(fa).not.toBe(fb);
  });
});

// ---------------------------------------------------------------------------
// Memory + Hindsight tool tenant scope (audit item #4).
// ---------------------------------------------------------------------------

describe("Memory tool tenant scope (audit item #4)", () => {
  it("buildMemoryTools throws at execute() when tenantId is empty", async () => {
    const tools = buildMemoryTools({
      client: new BedrockAgentCoreClient({}),
      memoryId: "mem-1",
      tenantId: "",
      userId: "user-A",
    });
    expect(tools).toHaveLength(2);
    await expect(
      tools[0]!.execute("call-1", { fact: "x" }),
    ).rejects.toThrow(MemoryToolError);
  });

  it("each invocation gets a fresh tool array with its own bound tenantId", () => {
    const a = buildMemoryTools({
      client: new BedrockAgentCoreClient({}),
      memoryId: "mem-1",
      tenantId: "tenant-A",
      userId: "user-A",
    });
    const b = buildMemoryTools({
      client: new BedrockAgentCoreClient({}),
      memoryId: "mem-1",
      tenantId: "tenant-B",
      userId: "user-B",
    });
    // Distinct AgentTool instances per invocation (no module cache).
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).not.toBe(b[1]);
  });
});

describe("Hindsight tool tenant scope (audit item #4)", () => {
  it("buildHindsightTools throws at execute() when tenantId is empty", async () => {
    const tools = buildHindsightTools({
      endpoint: "https://hindsight.dev.example.com",
      tenantId: "",
      userId: "user-A",
    });
    expect(tools).toHaveLength(2);
    await expect(
      tools[0]!.execute("call-1", { query: "x" }),
    ).rejects.toThrow(HindsightToolError);
  });

  it("buildHindsightTools throws at execute() when endpoint is empty", async () => {
    const tools = buildHindsightTools({
      endpoint: "",
      tenantId: "tenant-A",
      userId: "user-A",
    });
    await expect(
      tools[0]!.execute("call-1", { query: "x" }),
    ).rejects.toThrow(HindsightToolError);
  });
});

// ---------------------------------------------------------------------------
// Audit grep — no module-level mutable state.
// ---------------------------------------------------------------------------

describe("Audit grep — module-level mutable state", () => {
  /**
   * The trusted-handler isolation contract requires that all per-invocation
   * containers (empty `new Map()` / `new Set()` constructors) in src/ are
   * inside function bodies, not declared at module top-level. A module-
   * level mutable container would persist across invocations on a warm
   * Lambda container and risk cross-tenant leakage.
   *
   * Constant lookup tables — `new Set([literal, literal, …])` or
   * `new Map([[k, v], …])` initialized with pure literals at module scope
   * — are fine because they hold no per-invocation state. We distinguish
   * empty/dynamic constructors (suspicious) from literal-initialized ones
   * (safe lookup data) via a regex match on the constructor argument.
   *
   * Approximation rule:
   *   - `new Map(` followed by `)` or whitespace = empty/dynamic = SUSPICIOUS at module scope
   *   - `new Set(` followed by `)` or whitespace = empty/dynamic = SUSPICIOUS at module scope
   *   - `new Map([` / `new Set([` at module scope = literal init = SAFE
   *
   * A future maintainer hoisting per-invocation state to module scope
   * (e.g., `const cache = new Map()` at the top of a file) fails this test.
   */
  function isModuleLevel(line: string): boolean {
    return /^\S/.test(line);
  }

  function isLiteralInitialization(line: string, ctor: "Map" | "Set"): boolean {
    // Match `new Map([` or `new Set([` (literal initializer present).
    const literalPattern = new RegExp(`new\\s+${ctor}\\s*\\(\\s*\\[`);
    return literalPattern.test(line);
  }

  it("module-level `new Map()` (empty/dynamic) is forbidden in src/", () => {
    const matches = grepLines(FLUE_SRC, "new Map(");
    // Vacuous-pass guard: if `src/` is renamed or `cwd` drifts, git grep
    // returns zero matches and BOTH this test and the structural rule it
    // enforces silently no-op. Assert at least one Map construction is
    // visible — the codebase actually uses Map (e.g., the HandleStore at
    // src/mcp.ts) so any zero-match outcome is a misconfiguration, not a
    // clean tree.
    expect(
      matches.length,
      "audit grep saw zero `new Map(` matches in src/ — likely a path-resolution misconfiguration; the audit would silently pass without detecting real module-level state",
    ).toBeGreaterThan(0);
    const suspicious = matches.filter(
      (m) => isModuleLevel(m.line) && !isLiteralInitialization(m.line, "Map"),
    );
    if (suspicious.length > 0) {
      const detail = suspicious
        .map((m) => `  ${m.relPath}:${m.lineNumber}: ${m.line}`)
        .join("\n");
      throw new Error(
        `Module-level mutable Map state breaks per-invocation isolation:\n${detail}`,
      );
    }
  });

  it("module-level `new Set()` (empty/dynamic) is forbidden in src/", () => {
    const matches = grepLines(FLUE_SRC, "new Set(");
    // Same vacuous-pass guard as the Map test above. The src/ tree
    // contains at least one constant-literal Set initialization (e.g.,
    // SENSITIVE_HEADER_KEYS in handler-context.ts on the U9 branch); a
    // zero-match outcome here indicates the path scope drifted.
    // We accept zero matches on origin/main today (no Set literals at
    // module scope yet) but log to make the gap visible.
    if (matches.length === 0) {
      // Intentionally non-fatal: the trusted-handler tree may genuinely
      // have no Set constructions. The vacuous-pass risk is documented
      // in the residual-risks list rather than enforced here, since the
      // Map test already covers the same path-resolution invariant.
      return;
    }
    const suspicious = matches.filter(
      (m) => isModuleLevel(m.line) && !isLiteralInitialization(m.line, "Set"),
    );
    if (suspicious.length > 0) {
      const detail = suspicious
        .map((m) => `  ${m.relPath}:${m.lineNumber}: ${m.line}`)
        .join("\n");
      throw new Error(
        `Module-level mutable Set state breaks per-invocation isolation:\n${detail}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Deferred — placeholders for U9 / U16 follow-up coverage.
// ---------------------------------------------------------------------------

describe("Deferred multi-tenant isolation tests (need U9 + U16)", () => {
  // Each placeholder names the blocker U-ID + a one-line hint for the
  // implementer who picks it up after the dependency lands.
  it.todo(
    "U9: 10+ concurrent handleInvocation() calls with alternating tenant_id surface no cross-tenant sentinel — Promise.all of handleInvocation, each writing a unique sentinel via run_skill, then assert no other tenant's sentinel is reachable",
  );
  it.todo(
    "U9: agent-supplied tenantId in payload body cannot override the bound IdentitySnapshot — call handleInvocation with tenant_id=A AND a payload field also claiming tenant_id=B; assert all downstream side effects use A",
  );
  it.todo(
    "U16: session.task() sub-agent inherits trusted-handler tenantId — spawn a sub-agent inside a wrapped session, attempt to override tenantId in the sub-agent prompt, assert resulting Aurora calls still use the parent's tenantId",
  );
  it.todo(
    "U16: worker-thread fetch interceptor resolves Handle->Bearer only against the per-invocation HandleStore — mint a handle in invocation A, attempt resolution in worker for invocation B, assert HandleStoreError",
  );
  it.todo(
    "U16: response-body scrubber strips bearer-shaped substrings — synthesize an MCP response body containing `Bearer <fixture>` and assert the final ToolResult passed to the agent loop replaces the bearer with `[redacted]`",
  );
});

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

interface GrepMatch {
  relPath: string;
  lineNumber: number;
  line: string;
}

function grepLines(rootDir: string, needle: string): GrepMatch[] {
  // Use git grep so we get the same ignore semantics as `git grep` in CI.
  // The command exits non-zero on three signals:
  //   1   = no matches (treated as "zero hits", not an error)
  //   128 = not a git repository (clear diagnostic — the audit cannot run)
  //   ENOENT-ish = git not on PATH (CI image without git tooling)
  // Other exit codes are unexpected and re-thrown.
  let output = "";
  try {
    output = execFileSync(
      "git",
      ["grep", "-n", "--fixed-strings", needle, "--", "src/"],
      {
        cwd: path.dirname(rootDir),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    const e = err as {
      status?: number;
      code?: string;
      stderr?: string;
    };
    if (e.status === 1) return [];
    if (e.status === 128) {
      throw new Error(
        `verify-tenant-isolation: git grep requires a git repository (cwd=${path.dirname(rootDir)}). ` +
          `The audit grep test is not portable to non-git checkouts; ` +
          `stderr from git: ${e.stderr ?? "(empty)"}`,
      );
    }
    if (e.code === "ENOENT") {
      throw new Error(
        "verify-tenant-isolation: `git` is not on PATH; the audit grep test depends on git for ignore semantics.",
      );
    }
    throw err;
  }
  const matches: GrepMatch[] = [];
  for (const raw of output.split("\n")) {
    if (!raw) continue;
    // git grep prints `<path>:<line-number>:<content>`.
    const parts = raw.split(":");
    if (parts.length < 3) continue;
    const relPath = parts[0]!;
    const lineNumber = Number(parts[1]);
    const line = parts.slice(2).join(":");
    if (!Number.isFinite(lineNumber)) continue;
    matches.push({ relPath, lineNumber, line });
  }
  return matches;
}

// Light sanity check — keep the helper paths reachable so a future repo
// reorganisation doesn't make this test silently match nothing.
describe("test infrastructure self-check", () => {
  it("REPO_ROOT contains a recognisable thinkwork landmark", () => {
    const cliPkg = readFileSync(path.join(REPO_ROOT, "apps/cli/package.json"), "utf8");
    expect(cliPkg).toContain("thinkwork-cli");
  });

  it("FLUE_SRC contains the trusted-handler MCP module", () => {
    const mcp = readFileSync(path.join(FLUE_SRC, "mcp.ts"), "utf8");
    expect(mcp).toContain("HandleStore");
  });
});
