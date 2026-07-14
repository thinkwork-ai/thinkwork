/**
 * Credential-binding readiness tests (THINK-280 U2 — R6, R7; AE2).
 *
 * DB mocked at the drizzle-operator seam over real schema tables; secret
 * resolution and probing go through injected fakes — no Secrets Manager,
 * no HTTP. The redaction tests are the point: credential values and probe
 * bodies must be unrepresentable in stored evidence.
 */

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  isNull: (col: unknown) => ({ _isNull: col }),
  ilike: (col: unknown, val: unknown) => ({ _ilike: [col, val] }),
  inArray: () => ({}),
  desc: () => ({}),
  asc: () => ({}),
  sql: Object.assign((..._args: unknown[]) => ({}), { raw: () => ({}) }),
  relations: () => ({}),
}));

import {
  capabilityCredentialBindings,
  capabilityDefinitionVersions,
  tenantServicePrincipals,
} from "@thinkwork/database-pg/schema";
import {
  createCredentialBinding,
  readOnlyHttpProbeRunner,
  revokeCredentialBinding,
  verifyCredentialBinding,
  type BindingProbeRunner,
} from "./readiness.js";
import type { Db } from "./research.js";

// ── fake db over real schema tables ─────────────────────────────────────

type Row = Record<string, any>;

function colName(col: unknown): string | null {
  return col && typeof col === "object" && typeof (col as any).name === "string"
    ? (col as any).name
    : null;
}

function rowMatches(row: Row, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as {
    _and?: unknown[];
    _or?: unknown[];
    _eq?: [unknown, unknown];
    _isNull?: unknown;
  };
  if (c._and) return c._and.every((child) => rowMatches(row, child));
  if (c._or) return c._or.some((child) => rowMatches(row, child));
  if (c._eq) {
    const name = colName(c._eq[0]);
    return name ? row[name] === c._eq[1] : true;
  }
  if (c._isNull !== undefined) {
    const name = colName(c._isNull);
    return name ? row[name] === null || row[name] === undefined : true;
  }
  return true;
}

function fakeDb(seed: Array<[unknown, Row[]]> = []) {
  const tables = new Map<unknown, Row[]>(seed);
  const inserts: Array<{ table: unknown; row: Row }> = [];
  const updates: Array<{ table: unknown; values: Row }> = [];
  const rowsFor = (t: unknown) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t)!;
  };
  const db: any = {
    select: () => ({
      from: (t: unknown) => {
        let rows = [...rowsFor(t)];
        const chain: any = {
          where(cond: unknown) {
            rows = rows.filter((r) => rowMatches(r, cond));
            return chain;
          },
          orderBy() {
            return chain;
          },
          limit(n: number) {
            rows = rows.slice(0, n);
            return chain;
          },
          then(onF: any, onR: any) {
            return Promise.resolve(rows).then(onF, onR);
          },
        };
        return chain;
      },
    }),
    insert: (t: unknown) => ({
      values: (v: Row) => ({
        returning: () => {
          const row: Row = { id: randomUUID(), created_at: new Date(), ...v };
          rowsFor(t).push(row);
          inserts.push({ table: t, row });
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (t: unknown) => ({
      set: (v: Row) => ({
        where: (cond: unknown) => {
          const matched = rowsFor(t).filter((r) => rowMatches(r, cond));
          for (const row of matched) Object.assign(row, v);
          updates.push({ table: t, values: v });
          return {
            returning: () => Promise.resolve([...matched]),
            then: (onF: any, onR: any) =>
              Promise.resolve(undefined).then(onF, onR),
          };
        },
      }),
    }),
    transaction: async (cb: (tx: any) => Promise<any>) => cb(db),
  };
  return { db: db as Db, tables, inserts, updates };
}

// ── fixtures ────────────────────────────────────────────────────────────

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const SECRET_VALUE = "ghp_super-secret-token-value";
const RESPONSE_BODY = "raw provider response body with pii";

function versionRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    definition_id: randomUUID(),
    version: 1,
    descriptor_json: { slug: "github-rest", operations: [] },
    descriptor_fingerprint: "d".repeat(64),
    contract_hashes_json: {},
    signature_json: null,
    lifecycle: "admitted",
    provenance_json: {},
    source_proposal_id: null,
    admitted_at: new Date(),
    admitted_by_user_id: null,
    created_at: new Date(),
    ...overrides,
  };
}

function principalRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    tenant_id: TENANT,
    slug: "reporting-bot",
    display_name: "Reporting Bot",
    purpose: null,
    status: "active",
    revoked_at: null,
    ...overrides,
  };
}

function bindingRow(version: Row, overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    tenant_id: TENANT,
    definition_version_id: version.id,
    principal_mode: "requester",
    service_principal_id: null,
    subject_user_id: null,
    credential_refs_json: { api_key: `secretsmanager:acme/api-key` },
    readiness: "pending_setup",
    readiness_evidence_json: {},
    last_verified_at: null,
    revoked_at: null,
    created_by_user_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const okResolver = {
  resolve: vi.fn(async () => ({ apiKey: SECRET_VALUE })),
};

function probeRunnerReturning(outcome: Row): BindingProbeRunner {
  return { probe: async () => outcome as any };
}

describe("createCredentialBinding", () => {
  it("creates a service-mode binding in pending_setup", async () => {
    const version = versionRow();
    const principal = principalRow();
    const { db } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [tenantServicePrincipals, [principal]],
    ]);
    const result = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: version.id as string,
      principalMode: "service",
      servicePrincipalId: principal.id as string,
      credentialRefs: { api_key: "secretsmanager:acme/api-key" },
    });
    expect(result.outcome).toBe("applied");
    expect(result.binding).toMatchObject({
      readiness: "pending_setup",
      principal_mode: "service",
      service_principal_id: principal.id,
      subject_user_id: null,
      credential_refs_json: { api_key: "secretsmanager:acme/api-key" },
    });
  });

  it("creates a requester binding with an optional user pin and no service principal", async () => {
    const version = versionRow();
    const userId = randomUUID();
    const { db } = fakeDb([[capabilityDefinitionVersions, [version]]]);
    const result = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: version.id as string,
      principalMode: "requester",
      subjectUserId: userId,
      credentialRefs: { token: randomUUID() },
    });
    expect(result.outcome).toBe("applied");
    expect(result.binding!.service_principal_id).toBeNull();
    expect(result.binding!.subject_user_id).toBe(userId);
  });

  it("enforces the principal-mode/subject pairing exactly as the DB CHECK does", async () => {
    const version = versionRow();
    const { db, inserts } = fakeDb([[capabilityDefinitionVersions, [version]]]);
    const cases: Array<{ input: Row; expected: string }> = [
      {
        input: { principalMode: "captain" },
        expected: "principalMode",
      },
      {
        input: { principalMode: "service" },
        expected: "servicePrincipalId: required for service mode",
      },
      {
        input: {
          principalMode: "service",
          servicePrincipalId: randomUUID(),
          subjectUserId: randomUUID(),
        },
        expected: "subjectUserId: must be null for service mode",
      },
      {
        input: { principalMode: "requester", servicePrincipalId: randomUUID() },
        expected: "servicePrincipalId: must be null for requester mode",
      },
      {
        input: {
          principalMode: "agent_owner",
          servicePrincipalId: randomUUID(),
        },
        expected: "servicePrincipalId: must be null for agent_owner mode",
      },
    ];
    for (const { input, expected } of cases) {
      const result = await createCredentialBinding(db, {
        tenantId: TENANT,
        definitionVersionId: version.id as string,
        credentialRefs: { api_key: "secretsmanager:x" },
        ...input,
      } as any);
      expect(result.outcome).toBe("rejected");
      expect(result.reason).toContain(expected);
    }
    expect(inserts).toHaveLength(0);
  });

  it("accepts vault-reference shapes and rejects raw-secret-looking values without echoing them", async () => {
    const version = versionRow();
    const { db } = fakeDb([[capabilityDefinitionVersions, [version]]]);
    const good = {
      a: "secretsmanager:acme/key",
      b: "ssm:/thinkwork/dev/x",
      c: "ref:something",
      d: "arn:aws:secretsmanager:us-east-1:1:secret:x",
      e: "API_KEY_ENV",
      f: randomUUID(), // tenant_credentials row id
      g: "tenant-credential:abc",
    };
    const ok = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: version.id as string,
      principalMode: "requester",
      credentialRefs: good,
    });
    expect(ok.outcome).toBe("applied");

    for (const raw of [SECRET_VALUE, "hunter2", "Bearer abc.def.ghi"]) {
      const rejected = await createCredentialBinding(db, {
        tenantId: TENANT,
        definitionVersionId: version.id as string,
        principalMode: "requester",
        credentialRefs: { api_key: raw },
      });
      expect(rejected.outcome).toBe("rejected");
      expect(rejected.reason).toContain("credentialRefs.api_key");
      // The possibly-secret value itself must never be echoed back.
      expect(rejected.reason).not.toContain(raw);
    }

    const notObject = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: version.id as string,
      principalMode: "requester",
      credentialRefs: ["secretsmanager:x"],
    });
    expect(notObject.outcome).toBe("rejected");
    expect(notObject.reason).toContain("credentialRefs: must be a JSON object");
  });

  it("rejects unknown versions and foreign/revoked service principals", async () => {
    const version = versionRow();
    const foreign = principalRow({ tenant_id: OTHER_TENANT });
    const revoked = principalRow({ status: "revoked" });
    const { db } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [tenantServicePrincipals, [foreign, revoked]],
    ]);

    const noVersion = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: randomUUID(),
      principalMode: "requester",
      credentialRefs: {},
    });
    expect(noVersion.reason).toBe("definition_version_not_found");

    const foreignPrincipal = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: version.id as string,
      principalMode: "service",
      servicePrincipalId: foreign.id as string,
      credentialRefs: {},
    });
    expect(foreignPrincipal.reason).toBe("service_principal_not_found");

    const revokedPrincipal = await createCredentialBinding(db, {
      tenantId: TENANT,
      definitionVersionId: version.id as string,
      principalMode: "service",
      servicePrincipalId: revoked.id as string,
      credentialRefs: {},
    });
    expect(revokedPrincipal.reason).toBe("service_principal_revoked");
  });
});

describe("verifyCredentialBinding", () => {
  it("moves the binding through verifying to ready and stores only redacted evidence", async () => {
    const version = versionRow();
    const binding = bindingRow(version);
    const { db, updates } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [capabilityCredentialBindings, [binding]],
    ]);
    const probe = vi.fn(async () => ({
      ok: true,
      statusCode: 200,
      durationMs: 42,
      // Hostile extra fields a runner might leak — must never be stored.
      body: RESPONSE_BODY,
      credential: { apiKey: SECRET_VALUE },
      headers: { authorization: `Bearer ${SECRET_VALUE}` },
    }));
    const result = await verifyCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: binding.id as string,
      secretResolver: okResolver,
      probeRunner: { probe },
    });

    expect(result.outcome).toBe("applied");
    expect(result.binding!.readiness).toBe("ready");
    expect(result.binding!.last_verified_at).toBeInstanceOf(Date);
    // Passed through the verifying state first.
    expect(
      updates
        .filter((u) => u.table === capabilityCredentialBindings)
        .map((u) => u.values.readiness),
    ).toEqual(["verifying", "ready"]);
    // Probe received the resolved credential + descriptor, read-only config.
    expect(probe).toHaveBeenCalledWith({
      descriptor: version.descriptor_json,
      probeConfig: { readOnly: true },
      credential: { api_key: { apiKey: SECRET_VALUE } },
    });
    // REDACTION: evidence is exactly the allowlist — the credential value
    // and the probe body are unrepresentable in the stored row.
    const evidence = result.binding!.readiness_evidence_json as Record<
      string,
      unknown
    >;
    expect(Object.keys(evidence).sort()).toEqual([
      "durationMs",
      "probedAt",
      "statusCode",
    ]);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain(RESPONSE_BODY);
    // The definition version lifecycle is never touched.
    expect(updates.some((u) => u.table === capabilityDefinitionVersions)).toBe(
      false,
    );
  });

  it("a failed probe degrades the binding with its failureKind and no last_verified_at", async () => {
    const version = versionRow();
    const binding = bindingRow(version);
    const { db } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [capabilityCredentialBindings, [binding]],
    ]);
    const result = await verifyCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: binding.id as string,
      secretResolver: okResolver,
      probeRunner: probeRunnerReturning({
        ok: false,
        statusCode: 401,
        failureKind: "auth_failed",
        body: RESPONSE_BODY,
      }),
    });
    expect(result.outcome).toBe("applied");
    expect(result.reason).toBe("auth_failed");
    expect(result.binding!.readiness).toBe("degraded");
    expect(result.binding!.last_verified_at).toBeNull();
    const evidence = result.binding!.readiness_evidence_json as Record<
      string,
      unknown
    >;
    expect(evidence.failureKind).toBe("auth_failed");
    expect(evidence.statusCode).toBe(401);
    expect(JSON.stringify(evidence)).not.toContain(RESPONSE_BODY);
  });

  it("a throwing probe degrades with probe_error; a throwing resolver degrades without probing", async () => {
    const version = versionRow();
    const b1 = bindingRow(version);
    const b2 = bindingRow(version);
    const { db } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [capabilityCredentialBindings, [b1, b2]],
    ]);

    const thrown = await verifyCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: b1.id as string,
      secretResolver: okResolver,
      probeRunner: {
        probe: async () => {
          throw new Error(`boom ${SECRET_VALUE}`);
        },
      },
    });
    expect(thrown.binding!.readiness).toBe("degraded");
    expect((thrown.binding!.readiness_evidence_json as Row).failureKind).toBe(
      "probe_error",
    );
    expect(
      JSON.stringify(thrown.binding!.readiness_evidence_json),
    ).not.toContain(SECRET_VALUE);

    const probe = vi.fn();
    const resolverFailed = await verifyCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: b2.id as string,
      secretResolver: {
        resolve: async () => {
          throw new Error("denied");
        },
      },
      probeRunner: { probe } as any,
    });
    expect(resolverFailed.binding!.readiness).toBe("degraded");
    expect(
      (resolverFailed.binding!.readiness_evidence_json as Row).failureKind,
    ).toBe("credential_resolution_failed");
    expect(probe).not.toHaveBeenCalled();
  });

  it("rejects unknown, foreign-tenant, and revoked bindings without state changes", async () => {
    const version = versionRow();
    const foreign = bindingRow(version, { tenant_id: OTHER_TENANT });
    const revoked = bindingRow(version, { readiness: "revoked" });
    const { db, updates } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [capabilityCredentialBindings, [foreign, revoked]],
    ]);

    for (const [bindingId, reason] of [
      [randomUUID(), "binding_not_found"],
      [foreign.id, "binding_not_found"],
      [revoked.id, "binding_revoked"],
    ] as const) {
      const result = await verifyCredentialBinding(db, {
        tenantId: TENANT,
        bindingId: bindingId as string,
        secretResolver: okResolver,
        probeRunner: readOnlyHttpProbeRunner,
      });
      expect(result.outcome).toBe("rejected");
      expect(result.reason).toBe(reason);
    }
    expect(updates).toHaveLength(0);
  });
});

describe("revokeCredentialBinding", () => {
  it("revokes once, then noops idempotently", async () => {
    const version = versionRow();
    const binding = bindingRow(version, { readiness: "ready" });
    const { db } = fakeDb([[capabilityCredentialBindings, [binding]]]);

    const first = await revokeCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: binding.id as string,
    });
    expect(first.outcome).toBe("applied");
    expect(first.binding!.readiness).toBe("revoked");
    expect(first.binding!.revoked_at).toBeInstanceOf(Date);

    const second = await revokeCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: binding.id as string,
    });
    expect(second.outcome).toBe("noop");
    expect(second.binding!.readiness).toBe("revoked");
  });

  it("rejects unknown bindings", async () => {
    const { db } = fakeDb();
    const result = await revokeCredentialBinding(db, {
      tenantId: TENANT,
      bindingId: randomUUID(),
    });
    expect(result).toEqual({
      outcome: "rejected",
      reason: "binding_not_found",
    });
  });
});

describe("readOnlyHttpProbeRunner", () => {
  const readOnlyGetDescriptor = (credential?: unknown) => ({
    operations: [
      {
        operationId: "issues.list",
        effect: "read",
        idempotency: "idempotent",
        targetScope: {
          resourceSelector: {
            method: "GET",
            host: "api.github.com",
            path: "/repos/facebook/react/issues",
            fixedQuery: { per_page: "1" },
            ...(credential ? { credential } : {}),
          },
        },
      },
    ],
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns ok on a 2xx read-only GET and never stores the body", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, status: 200, body: { cancel } } as never);
    const out = await readOnlyHttpProbeRunner.probe({
      descriptor: readOnlyGetDescriptor(),
      probeConfig: { readOnly: true },
      credential: {},
    });
    expect(out.ok).toBe(true);
    expect(out.statusCode).toBe(200);
    const url = fetchSpy.mock.calls[0]![0] as URL;
    expect(url.toString()).toBe(
      "https://api.github.com/repos/facebook/react/issues?per_page=1",
    );
    expect(cancel).toHaveBeenCalled();
  });

  it("degrades with http_<status> on a 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      body: null,
    } as never);
    const out = await readOnlyHttpProbeRunner.probe({
      descriptor: readOnlyGetDescriptor(),
      probeConfig: { readOnly: true },
      credential: {},
    });
    expect(out.ok).toBe(false);
    expect(out.failureKind).toBe("http_403");
  });

  it("applies a declared bearer credential as the Authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    } as never);
    await readOnlyHttpProbeRunner.probe({
      descriptor: readOnlyGetDescriptor({
        name: "github",
        field: "token",
        placement: "header",
        param: "Authorization",
        scheme: "Bearer",
      }),
      probeConfig: { readOnly: true },
      credential: { github: { token: "ghp_secret" } },
    });
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit)
      .headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer ghp_secret");
  });

  it("degrades (never throws) when the descriptor has no read-only GET op", async () => {
    const out = await readOnlyHttpProbeRunner.probe({
      descriptor: { operations: [{ effect: "write", idempotency: "unsafe" }] },
      probeConfig: { readOnly: true },
      credential: {},
    });
    expect(out.ok).toBe(false);
    expect(out.failureKind).toBe("no_read_only_probe_operation");
  });

  it("degrades (never throws) when the target is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await readOnlyHttpProbeRunner.probe({
      descriptor: readOnlyGetDescriptor(),
      probeConfig: { readOnly: true },
      credential: {},
    });
    expect(out.ok).toBe(false);
    expect(out.failureKind).toBe("probe_unreachable");
  });
});
