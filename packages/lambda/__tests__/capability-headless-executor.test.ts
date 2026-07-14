/**
 * THINK-280 U7 acceptance tests for the capability-headless executor.
 *
 * Every test runs with a fake DB, a fake DynamoDB session store, and a fake
 * python task — ZERO AWS, ZERO live provider calls. The tracer's provider/
 * platform operations are served through the U6 fixture adapter registry so the
 * "happy path" proves the sandbox's declared operations resolve deterministically
 * without reaching a real provider.
 */

import { describe, expect, it } from "vitest";
import { schema } from "@thinkwork/database-pg";
import { createFixtureAdapterRegistry } from "../lib/capability-broker/adapters/fixture.js";
import { createFakeDynamo } from "./capability-broker-fakes.js";
import {
  buildOperationsMap,
  executeCapabilityHeadlessRoutine,
  extractHeadlessResult,
  HEADLESS_RESULT_MARKER,
  preflightReadiness,
  type CapabilityDependency,
  type CapabilityHeadlessOptions,
} from "../capability-headless-executor.js";
import { formatTwcapRef, parseTwcapRef } from "@thinkwork/capability-contracts";
import type { PythonTaskResult } from "../routine-task-python.js";

const {
  routines,
  routineExecutions,
  routineStepEvents,
  capabilityBrokerSessions,
  capabilityBrokerCalls,
  capabilityCredentialBindings,
  capabilityDefinitionVersions,
  tenantServicePrincipals,
  inboxItems,
} = schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const ROUTINE_ID = "11111111-1111-4111-8111-111111111111";
const SP_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const BINDING_ID = "44444444-4444-4444-8444-444444444444";
const VALIDATED_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CONTRACT_HASH = "sha256:issueslist";
const TWCAP = "twcap:acme/connection/github-rest@1#issues.list";
const SESSION_TABLE = "twcap-sessions";

const DEP: CapabilityDependency = {
  twcap: TWCAP,
  contractHash: CONTRACT_HASH,
  definitionVersionId: VERSION_ID,
  operationId: "issues.list",
};

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

interface FakeDbState {
  routines: Record<string, unknown>[];
  servicePrincipals: Record<string, unknown>[];
  versions: Record<string, unknown>[];
  bindings: Record<string, unknown>[];
  inbox: Record<string, unknown>[];
  inserts: { table: unknown; values: Record<string, unknown> }[];
  updates: { table: unknown; set: Record<string, unknown> }[];
}

function fakeDb(state: Partial<FakeDbState>) {
  const s: FakeDbState = {
    routines: [],
    servicePrincipals: [],
    versions: [],
    bindings: [],
    inbox: [],
    inserts: [],
    updates: [],
    ...state,
  };
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === routines) return s.routines;
    if (table === tenantServicePrincipals) return s.servicePrincipals;
    if (table === capabilityDefinitionVersions) return s.versions;
    if (table === capabilityCredentialBindings) return s.bindings;
    if (table === inboxItems) return s.inbox;
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
        s.inserts.push({ table, values });
        return Promise.resolve([]);
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
  };
  return { db: db as never, state: s };
}

function baseRoutine(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTINE_ID,
    tenant_id: TENANT,
    name: "issue-health",
    engine: "git_python",
    module_path: "main.py",
    status: "active",
    validated_sha: VALIDATED_SHA,
    capability_dependencies: [DEP],
    execution_principal: { mode: "service", servicePrincipalId: SP_ID },
    credential_refs: [],
    ...overrides,
  };
}

function activePrincipal() {
  return { id: SP_ID, tenant_id: TENANT, status: "active", slug: "issues-bot" };
}
function admittedVersion() {
  return {
    id: VERSION_ID,
    lifecycle: "admitted",
    contract_hashes_json: { "issues.list": CONTRACT_HASH },
  };
}
function readyBinding(readiness = "ready") {
  return {
    id: BINDING_ID,
    definition_version_id: VERSION_ID,
    principal_mode: "service",
    service_principal_id: SP_ID,
    readiness,
  };
}

function baseOptions(
  overrides: Partial<CapabilityHeadlessOptions> = {},
): CapabilityHeadlessOptions {
  return {
    interpreterId: "interp-capability-private",
    bucket: "routine-output",
    sessionStore: createFakeDynamo(),
    sessionTableName: SESSION_TABLE,
    brokerAudience: "broker-aud",
    brokerEndpoint: "vpce-1234.execute-api.us-east-1.vpce.amazonaws.com",
    brokerApiId: "abc123",
    loadModuleCode: async () => "def run(input):\n    return {}\n",
    now: () => new Date("2026-07-13T00:00:00Z"),
    ...overrides,
  };
}

/** A fake python task that serves the tracer's ops through the fixture adapter
 * registry (ZERO live calls) and returns the sandbox's structured result. */
function fixtureBackedPythonTask(opts?: {
  artifactId?: string;
  throwError?: Error;
}) {
  const artifactId = opts?.artifactId ?? "artifact-1";
  const registry = createFixtureAdapterRegistry([
    {
      operationRef: "issues.list",
      input: { state: "open", page: 1 },
      result: [
        { number: 1, state: "open", created_at: "2026-01-01T00:00:00Z" },
      ],
    },
    {
      operationRef: "artifact.create",
      input: { title: "Issue health" },
      result: { kind: "artifact", ref: artifactId },
    },
  ]);
  const calls: string[] = [];
  const task = async (): Promise<PythonTaskResult> => {
    if (opts?.throwError) throw opts.throwError;
    // Simulate the sandbox dispatching ONLY the declared ops through the
    // fixture registry — no network, no provider credential.
    const adapter = registry.lookup("fixture" as never);
    const listed = await adapter!.dispatch({
      operationRef: "issues.list",
      input: { state: "open", page: 1 },
    } as never);
    const artifact = await adapter!.dispatch({
      operationRef: "artifact.create",
      input: { title: "Issue health" },
    } as never);
    calls.push("issues.list", "artifact.create");
    const digest = { totals: { open: 1, stale: 1, unowned: 1 } };
    const result = {
      ok: true,
      digest,
      artifactId:
        artifact.status === "completed"
          ? (artifact.data as { ref: string }).ref
          : null,
      brokerCalls: [
        { operationRef: "issues.list", effect: "read", status: "completed" },
        {
          operationRef: "artifact.create",
          effect: "write",
          status: "completed",
          durableRef: {
            kind: "artifact",
            ref: (artifact.status === "completed"
              ? (artifact.data as { ref: string }).ref
              : null) as string,
          },
        },
      ],
    };
    void listed;
    return {
      exitCode: 0,
      stdoutS3Uri: "s3://bucket/stdout.log",
      stderrS3Uri: null,
      stdoutPreview: `${HEADLESS_RESULT_MARKER}${JSON.stringify(result)}\n`,
      truncated: false,
    };
  };
  return { task, calls };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("capability-headless happy path", () => {
  it("resolves the green SHA + ready service binding, runs bounded reads, writes one Artifact, zero agent turns", async () => {
    const { db, state } = fakeDb({
      routines: [baseRoutine()],
      servicePrincipals: [activePrincipal()],
      versions: [admittedVersion()],
      bindings: [readyBinding()],
    });
    const store = createFakeDynamo();
    const { task, calls } = fixtureBackedPythonTask();

    const result = await executeCapabilityHeadlessRoutine(
      { routineId: ROUTINE_ID, triggerSource: "schedule" },
      baseOptions({ database: db, sessionStore: store, pythonTask: task }),
    );

    expect(result.status).toBe("succeeded");
    expect(result.readinessOutcome).toBe("ready");
    expect(result.commitSha).toBe(VALIDATED_SHA);
    expect(result.artifactId).toBe("artifact-1");
    // Only the declared ops were exercised — via the fixture registry.
    expect(calls).toEqual(["issues.list", "artifact.create"]);

    // Ledger: running row stamped with the full pre-session evidence.
    const execInsert = state.inserts.find((i) => i.table === routineExecutions);
    expect(execInsert?.values.status).toBe("running");
    expect(execInsert?.values.execution_principal).toMatchObject({
      mode: "service",
      servicePrincipalId: SP_ID,
      bindingId: BINDING_ID,
    });
    expect(execInsert?.values.readiness_outcome).toBe("ready");
    expect(execInsert?.values.commit_sha).toBe(VALIDATED_SHA);
    expect(execInsert?.values.config_fingerprint).toBeTruthy();

    // A broker session was minted, recorded, and CLOSED (finally path).
    const sessionInsert = state.inserts.find(
      (i) => i.table === capabilityBrokerSessions,
    );
    expect(sessionInsert?.values.status).toBe("active");
    const sessionClose = state.updates.find(
      (u) => u.table === capabilityBrokerSessions && u.set.status === "closed",
    );
    expect(sessionClose).toBeTruthy();
    expect(store.updateCount).toBeGreaterThan(0); // Dynamo closeSession fired.

    // Broker-call evidence + a digest step linking the produced Artifact.
    const brokerCalls = state.inserts.filter(
      (i) => i.table === capabilityBrokerCalls,
    );
    expect(brokerCalls.length).toBe(2);
    const step = state.inserts.find((i) => i.table === routineStepEvents);
    expect(step?.values.artifact_id).toBe("artifact-1");
    expect(step?.values.broker_call_id).toBeTruthy();

    // Terminal succeeded.
    const terminal = state.updates.find(
      (u) => u.table === routineExecutions && u.set.status === "succeeded",
    );
    expect(terminal).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AE2 — service-mode run with only a requester binding ready
// ---------------------------------------------------------------------------

describe("AE2 — no fallback across principal modes", () => {
  it("blocks before any session/provider work when the service binding is not present", async () => {
    // Only a requester binding exists in the world; the executor only ever
    // queries the SERVICE binding, which is absent → blocked, no fallback.
    const { db, state } = fakeDb({
      routines: [baseRoutine()],
      servicePrincipals: [activePrincipal()],
      versions: [admittedVersion()],
      bindings: [], // no service binding
    });
    const store = createFakeDynamo();
    let taskCalled = false;

    const result = await executeCapabilityHeadlessRoutine(
      { routineId: ROUTINE_ID },
      baseOptions({
        database: db,
        sessionStore: store,
        pythonTask: async () => {
          taskCalled = true;
          throw new Error("should never run");
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.readinessOutcome).toBe("blocked");
    expect(result.remediation?.kind).toBe("binding_missing");
    // No session opened, no sandbox run, no provider work.
    expect(taskCalled).toBe(false);
    expect(store.putCount).toBe(0);
    expect(
      state.inserts.some((i) => i.table === capabilityBrokerSessions),
    ).toBe(false);
    // A terminal blocked run + one operator remediation item.
    const execInsert = state.inserts.find((i) => i.table === routineExecutions);
    expect(execInsert?.values.status).toBe("blocked");
    expect(state.inserts.some((i) => i.table === inboxItems)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AE8 — binding revoked between runs
// ---------------------------------------------------------------------------

describe("AE8 — revocation fails closed", () => {
  it("performs zero GitHub calls and records blocked + remediation when the service binding is revoked", async () => {
    const { db, state } = fakeDb({
      routines: [baseRoutine()],
      servicePrincipals: [activePrincipal()],
      versions: [admittedVersion()],
      bindings: [readyBinding("revoked")],
    });
    const store = createFakeDynamo();
    let taskCalled = false;

    const result = await executeCapabilityHeadlessRoutine(
      { routineId: ROUTINE_ID },
      baseOptions({
        database: db,
        sessionStore: store,
        pythonTask: async () => {
          taskCalled = true;
          throw new Error("should never run");
        },
      }),
    );

    expect(result.status).toBe("blocked");
    expect(result.remediation?.kind).toBe("binding_revoked");
    expect(result.remediation?.bindingId).toBe(BINDING_ID);
    expect(taskCalled).toBe(false);
    expect(store.putCount).toBe(0);
    const inbox = state.inserts.find((i) => i.table === inboxItems);
    expect(inbox?.values.type).toBe("capability_run_blocked");
  });
});

// ---------------------------------------------------------------------------
// Degraded binding → attributable but reduced run
// ---------------------------------------------------------------------------

describe("degraded binding", () => {
  it("proceeds on a degraded binding and reports a degraded outcome + remediation", async () => {
    const { db } = fakeDb({
      routines: [baseRoutine()],
      servicePrincipals: [activePrincipal()],
      versions: [admittedVersion()],
      bindings: [readyBinding("degraded")],
    });
    const { task } = fixtureBackedPythonTask();
    const result = await executeCapabilityHeadlessRoutine(
      { routineId: ROUTINE_ID },
      baseOptions({ database: db, pythonTask: task }),
    );
    expect(result.status).toBe("degraded");
    expect(result.readinessOutcome).toBe("degraded");
    expect(result.remediation?.kind).toBe("binding_degraded");
    expect(result.artifactId).toBe("artifact-1");
  });
});

// ---------------------------------------------------------------------------
// Error paths — contract drift, config mismatch, stale approval
// ---------------------------------------------------------------------------

describe("preflight error paths fail closed", () => {
  const world = (bindings: Record<string, unknown>[]) => ({
    servicePrincipals: [activePrincipal()],
    versions: [admittedVersion()],
    bindings,
  });

  it("contract drift → blocked", async () => {
    const decision = await preflightReadiness(
      fakeDb(world([readyBinding()])).db,
      {
        routine: {
          id: ROUTINE_ID,
          tenant_id: TENANT,
          validated_sha: VALIDATED_SHA,
          capability_dependencies: [{ ...DEP, contractHash: "sha256:STALE" }],
        },
        principal: { mode: "service", servicePrincipalId: SP_ID },
        expectedConfigFingerprint: null,
      },
    );
    expect(decision.outcome).toBe("blocked");
    expect(decision.remediation?.kind).toBe("contract_drift");
  });

  it("config fingerprint mismatch → blocked", async () => {
    const decision = await preflightReadiness(
      fakeDb(world([readyBinding()])).db,
      {
        routine: {
          id: ROUTINE_ID,
          tenant_id: TENANT,
          validated_sha: VALIDATED_SHA,
          capability_dependencies: [DEP],
        },
        principal: { mode: "service", servicePrincipalId: SP_ID },
        expectedConfigFingerprint: "deadbeef-not-the-real-fingerprint",
      },
    );
    expect(decision.outcome).toBe("blocked");
    expect(decision.remediation?.kind).toBe("config_fingerprint_mismatch");
  });

  it("stale approval — no validated SHA → blocked", async () => {
    const decision = await preflightReadiness(
      fakeDb(world([readyBinding()])).db,
      {
        routine: {
          id: ROUTINE_ID,
          tenant_id: TENANT,
          validated_sha: null,
          capability_dependencies: [DEP],
        },
        principal: { mode: "service", servicePrincipalId: SP_ID },
        expectedConfigFingerprint: null,
      },
    );
    expect(decision.outcome).toBe("blocked");
    expect(decision.remediation?.kind).toBe("no_validated_sha");
  });

  it("un-admitted definition version → stale_approval blocked", async () => {
    const { db } = fakeDb({
      servicePrincipals: [activePrincipal()],
      versions: [{ ...admittedVersion(), lifecycle: "candidate" }],
      bindings: [readyBinding()],
    });
    const decision = await preflightReadiness(db, {
      routine: {
        id: ROUTINE_ID,
        tenant_id: TENANT,
        validated_sha: VALIDATED_SHA,
        capability_dependencies: [DEP],
      },
      principal: { mode: "service", servicePrincipalId: SP_ID },
      expectedConfigFingerprint: null,
    });
    expect(decision.outcome).toBe("blocked");
    expect(decision.remediation?.kind).toBe("stale_approval");
  });
});

// ---------------------------------------------------------------------------
// Error path — sandbox throw still closes the session
// ---------------------------------------------------------------------------

describe("mid-run failure always closes the broker session", () => {
  it("cancels the session and records a terminal failed run when the sandbox throws", async () => {
    const { db, state } = fakeDb({
      routines: [baseRoutine()],
      servicePrincipals: [activePrincipal()],
      versions: [admittedVersion()],
      bindings: [readyBinding()],
    });
    const store = createFakeDynamo();
    const { task } = fixtureBackedPythonTask({
      throwError: new Error("broker timeout mid-run"),
    });

    const result = await executeCapabilityHeadlessRoutine(
      { routineId: ROUTINE_ID },
      baseOptions({ database: db, sessionStore: store, pythonTask: task }),
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("broker timeout");
    // Session was minted then CANCELLED in the finally path.
    expect(store.putCount).toBe(1);
    const cancel = state.updates.find(
      (u) =>
        u.table === capabilityBrokerSessions && u.set.status === "cancelled",
    );
    expect(cancel).toBeTruthy();
    const terminal = state.updates.find(
      (u) => u.table === routineExecutions && u.set.status === "failed",
    );
    expect(terminal).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Principal-mode guard — never infer / fall back
// ---------------------------------------------------------------------------

describe("principal-mode guard", () => {
  it("refuses a non-service principal without touching the ledger", async () => {
    const { db, state } = fakeDb({
      routines: [baseRoutine({ execution_principal: { mode: "requester" } })],
    });
    const result = await executeCapabilityHeadlessRoutine(
      { routineId: ROUTINE_ID },
      baseOptions({ database: db }),
    );
    expect(result.status).toBe("failed");
    expect(result.errorClass).toBe("infra_not_service_principal");
    expect(state.inserts.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Result marker parsing
// ---------------------------------------------------------------------------

describe("extractHeadlessResult", () => {
  it("parses the structured digest behind the marker", () => {
    const parsed = extractHeadlessResult({
      exitCode: 0,
      stdoutS3Uri: null,
      stderrS3Uri: null,
      stdoutPreview: `noise\n${HEADLESS_RESULT_MARKER}{"ok":true,"artifactId":"x"}\n`,
      truncated: false,
    });
    expect(parsed?.ok).toBe(true);
    expect(parsed?.artifactId).toBe("x");
  });

  it("returns null when no marker is present", () => {
    expect(
      extractHeadlessResult({
        exitCode: 0,
        stdoutS3Uri: null,
        stderrS3Uri: null,
        stdoutPreview: "no marker here",
        truncated: false,
      }),
    ).toBeNull();
  });
});

describe("buildOperationsMap", () => {
  const HEX =
    "7a4e8d11ce339e1819984e8c85a39580a59ee45bcd7726cda534bc37456dd1af";

  it("maps a friendly operationId to its canonical twcap reference", () => {
    const dep: CapabilityDependency = {
      twcap:
        "twcap:sleek-squirrel-230/connection/github-rest-public@1#issues.list",
      contractHash: HEX,
      definitionVersionId: VERSION_ID,
      operationId: "issues.list",
    };
    const map = buildOperationsMap([dep]);
    const canonical = map["issues.list"];
    expect(canonical).toBe(
      formatTwcapRef({
        namespace: "sleek-squirrel-230",
        class: "connection",
        slug: "github-rest-public",
        version: "1",
        operationId: "issues.list",
        contractHash: HEX,
      }),
    );
    // The canonical form the SDK sends must round-trip through the broker parser.
    const ref = parseTwcapRef(canonical);
    expect(ref.operationId).toBe("issues.list");
    expect(ref.contractHash).toBe(HEX);
    expect(ref.slug).toBe("github-rest-public");
  });

  it("derives the operationId from the twcap fragment when absent", () => {
    const dep: CapabilityDependency = {
      twcap: "twcap:ns/connection/slug@2#repos.get",
      contractHash: HEX,
      definitionVersionId: VERSION_ID,
    };
    const map = buildOperationsMap([dep]);
    expect(Object.keys(map)).toEqual(["repos.get"]);
    expect(parseTwcapRef(map["repos.get"]).version).toBe("2");
  });

  it("drops a dependency whose contract hash is not valid sha256 hex", () => {
    const dep: CapabilityDependency = {
      twcap: "twcap:ns/connection/slug@1#op",
      contractHash: "sha256:not-hex",
      definitionVersionId: VERSION_ID,
      operationId: "op",
    };
    expect(buildOperationsMap([dep])).toEqual({});
  });

  it("drops a malformed compact reference rather than half-parsing it", () => {
    const dep: CapabilityDependency = {
      twcap: "twcap:ns/connection/slug#op",
      contractHash: HEX,
      definitionVersionId: VERSION_ID,
      operationId: "op",
    };
    expect(buildOperationsMap([dep])).toEqual({});
  });
});
