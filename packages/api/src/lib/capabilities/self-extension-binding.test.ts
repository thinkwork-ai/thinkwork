/**
 * U2b — auto-provision service principal + empty-credential binding for an
 * autonomously self-admitted public capability, driving it to `ready` via the
 * read-only reachability probe. Fail-closed at every step.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  capabilityCredentialBindings,
  capabilityDefinitionVersions,
  tenantServicePrincipals,
} from "@thinkwork/database-pg/schema";
import type { Db } from "./research.js";
import type { BindingProbeRunner } from "./readiness.js";
import {
  autoProvisionServiceBinding,
  selfExtensionServicePrincipalSlug,
} from "./self-extension-binding.js";

// ── fake db over real schema tables (mirrors readiness.test.ts) ─────────────

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
  return { db: db as Db, tables, inserts };
}

// ── fixtures ────────────────────────────────────────────────────────────────

const TENANT = randomUUID();
const AGENT = randomUUID();

function versionRow(overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    definition_id: randomUUID(),
    version: 1,
    // A public read-only GET op — the probe picks this.
    descriptor_json: {
      slug: "github-rest",
      operations: [
        {
          effect: "read",
          idempotency: "idempotent",
          targetScope: {
            resourceSelector: {
              method: "GET",
              host: "api.github.com",
              path: "/repos/vercel/next.js",
            },
          },
        },
      ],
    },
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
    slug: selfExtensionServicePrincipalSlug(AGENT),
    display_name: `Agent ${AGENT} (self-extension)`,
    purpose: "autonomous self-extension",
    status: "active",
    revoked_at: null,
    created_by_user_id: null,
    ...overrides,
  };
}

const noSecretsResolver = { resolve: vi.fn(async () => ({})) };

function probeRunnerReturning(outcome: Row): BindingProbeRunner {
  return { probe: async () => outcome as any };
}

const reachableProbe = probeRunnerReturning({ ok: true, statusCode: 200 });

// ── tests ─────────────────────────────────────────────────────────────────

describe("selfExtensionServicePrincipalSlug", () => {
  it("is deterministic and slug-safe", () => {
    const slug = selfExtensionServicePrincipalSlug(AGENT);
    expect(slug).toBe(`agent-${AGENT}`);
    expect(slug).toMatch(/^[a-z0-9-]{1,64}$/);
  });
});

describe("autoProvisionServiceBinding", () => {
  it("provisions a fresh SP + empty binding and drives it to ready", async () => {
    const version = versionRow();
    const { db, inserts } = fakeDb([[capabilityDefinitionVersions, [version]]]);

    const result = await autoProvisionServiceBinding(
      db,
      {
        tenantId: TENANT,
        definitionVersionId: version.id as string,
        agentId: AGENT,
      },
      { probeRunner: reachableProbe, secretResolver: noSecretsResolver },
    );

    expect(result.outcome).toBe("ready");
    expect(result.servicePrincipalId).toBeTruthy();
    expect(result.binding?.readiness).toBe("ready");
    // Empty credential refs — a public op wires no secrets.
    expect(result.binding?.credential_refs_json).toEqual({});
    expect(result.binding?.principal_mode).toBe("service");
    expect(result.binding?.created_by_user_id).toBeNull();

    // Exactly one SP created, autonomously (no operator).
    const spInserts = inserts.filter(
      (i) => i.table === tenantServicePrincipals,
    );
    expect(spInserts).toHaveLength(1);
    expect(spInserts[0]!.row.created_by_user_id).toBeNull();
    expect(spInserts[0]!.row.purpose).toBe("autonomous self-extension");
  });

  it("reuses an existing active service principal (idempotent)", async () => {
    const version = versionRow();
    const existing = principalRow();
    const { db, inserts } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [tenantServicePrincipals, [existing]],
    ]);

    const result = await autoProvisionServiceBinding(
      db,
      {
        tenantId: TENANT,
        definitionVersionId: version.id as string,
        agentId: AGENT,
      },
      { probeRunner: reachableProbe, secretResolver: noSecretsResolver },
    );

    expect(result.outcome).toBe("ready");
    expect(result.servicePrincipalId).toBe(existing.id);
    // No new SP — the existing one was reused.
    expect(
      inserts.filter((i) => i.table === tenantServicePrincipals),
    ).toHaveLength(0);
    expect(result.binding?.service_principal_id).toBe(existing.id);
  });

  it("fail-closed: a revoked agent SP blocks provisioning entirely", async () => {
    const version = versionRow();
    const revoked = principalRow({ status: "revoked", revoked_at: new Date() });
    const { db, inserts } = fakeDb([
      [capabilityDefinitionVersions, [version]],
      [tenantServicePrincipals, [revoked]],
    ]);

    const result = await autoProvisionServiceBinding(
      db,
      {
        tenantId: TENANT,
        definitionVersionId: version.id as string,
        agentId: AGENT,
      },
      { probeRunner: reachableProbe, secretResolver: noSecretsResolver },
    );

    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("service_principal_revoked");
    // No binding created when the SP is unusable.
    expect(
      inserts.filter((i) => i.table === capabilityCredentialBindings),
    ).toHaveLength(0);
  });

  it("degrades (not rejects) when the probe cannot confirm reachability", async () => {
    const version = versionRow();
    const { db } = fakeDb([[capabilityDefinitionVersions, [version]]]);

    const result = await autoProvisionServiceBinding(
      db,
      {
        tenantId: TENANT,
        definitionVersionId: version.id as string,
        agentId: AGENT,
      },
      {
        probeRunner: probeRunnerReturning({
          ok: false,
          failureKind: "probe_unreachable",
        }),
        secretResolver: noSecretsResolver,
      },
    );

    // Admission succeeded; the binding exists but is not runnable yet.
    expect(result.outcome).toBe("degraded");
    expect(result.binding?.readiness).toBe("degraded");
    expect(result.servicePrincipalId).toBeTruthy();
  });
});
