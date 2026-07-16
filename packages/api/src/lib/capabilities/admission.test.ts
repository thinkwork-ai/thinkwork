/**
 * Connection admission tests (THINK-280 U2 — R4, R5; A3; AE3).
 *
 * DB mocked at the drizzle-operator seam over real schema tables; the
 * signer is a real Ed25519 keypair (sidecar-signing envelope shape); the
 * folder projection goes through a recording writer stub — no S3.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

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
  capabilityApprovals,
  capabilityConnectionProposals,
  capabilityDefinitions,
  capabilityDefinitionVersions,
  tenants,
  tenantServicePrincipals,
} from "@thinkwork/database-pg/schema";
import {
  canonicalSha256Hex,
  descriptorFingerprint,
  formatTwcapRef,
  operationContractHash,
  type CapabilityDescriptor,
} from "@thinkwork/capability-contracts";
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
} from "./sidecar-signing.js";
import { parseConnectionDefinition } from "./definition-schemas.js";
import {
  admitConnectionProposal,
  autonomouslyAdmitProposal,
  connectionDefinitionFromDescriptor,
  createCandidateVersion,
  type AdmissionFolderWriter,
} from "./admission.js";
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
const ADMIN = randomUUID();

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = capabilitySignerFromKey(privateKey);
const verifier = capabilityVerifierFromKey(publicKey);

function makeOperation(overrides: Row = {}): Row {
  return {
    operationId: "get-user",
    summary: "Read the authenticated user",
    effect: "read",
    targetScope: { kind: "open_world" },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    inputDataClass: "internal",
    outputDataClass: "internal",
    costClass: "free",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

function makeDescriptor(overrides: Row = {}): CapabilityDescriptor {
  return {
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    version: "1",
    adapter: {
      kind: "http_openapi",
      config: { baseUrl: "https://api.github.com" },
    },
    bindingRequirements: {
      credentialKinds: ["api_key"],
      principalModes: ["service"],
    },
    provenance: {
      sourceUrls: ["https://docs.github.com/rest"],
      evidenceRefs: [],
    },
    operations: [makeOperation()],
    ...overrides,
  } as unknown as CapabilityDescriptor;
}

function proposalRowFor(payload: Row, overrides: Row = {}): Row {
  return {
    id: randomUUID(),
    tenant_id: TENANT,
    definition_id: null,
    payload_json: payload,
    payload_fingerprint: canonicalSha256Hex(payload),
    provenance_json: { sourceUrls: ["https://docs.github.com/rest"] },
    status: "draft",
    inbox_item_id: null,
    created_by_actor_type: "agent",
    created_by_actor_id: null,
    decided_at: null,
    decided_by_user_id: null,
    created_at: new Date("2026-07-10T00:00:00Z"),
    ...overrides,
  };
}

function recordingWriter(
  result: { ok: boolean; reason?: string } = { ok: true },
) {
  const calls: Row[] = [];
  const writer: AdmissionFolderWriter = {
    write: async (input) => {
      calls.push(input as unknown as Row);
      return result as any;
    },
  };
  return { writer, calls };
}

describe("admitConnectionProposal", () => {
  it("admits a reviewed proposal: signed version 1, decided proposal, folder projection", async () => {
    const descriptor = makeDescriptor();
    const payload = { descriptor, displayName: "GitHub REST" };
    const proposal = proposalRowFor(payload);
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);
    const { writer, calls } = recordingWriter();

    const result = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: proposal.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
      folderWriter: writer,
    });

    expect(result.outcome).toBe("applied");
    expect(result.reason).toBeUndefined();

    // Definition: tenant-scoped, identity from the descriptor.
    expect(result.definition).toMatchObject({
      tenant_id: TENANT,
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      display_name: "GitHub REST",
      status: "active",
    });

    // Version row: admitted, fingerprinted, hashed, signed, provenance-linked.
    const version = result.version!;
    expect(version.version).toBe(1);
    expect(version.lifecycle).toBe("admitted");
    expect(version.descriptor_json).toEqual(descriptor);
    expect(version.descriptor_fingerprint).toBe(
      descriptorFingerprint(descriptor),
    );
    expect(version.contract_hashes_json).toEqual({
      "get-user": operationContractHash(descriptor.operations[0]!),
    });
    expect(version.source_proposal_id).toBe(proposal.id);
    expect(version.admitted_by_user_id).toBe(ADMIN);
    expect(version.admitted_at).toBeInstanceOf(Date);
    expect(version.provenance_json).toMatchObject({
      sourceUrls: ["https://docs.github.com/rest"],
      proposalId: proposal.id,
      proposalFingerprint: proposal.payload_fingerprint,
    });

    // Signature: real Ed25519 envelope over the canonical descriptor payload.
    const envelope = version.signature_json as Record<string, unknown>;
    expect(envelope).toMatchObject({
      algorithm: "Ed25519",
      signed_by: `operator:${ADMIN}`,
    });
    expect(
      verifier.verifyPayload(
        descriptor as unknown as Record<string, unknown>,
        envelope,
      ),
    ).toBe(true);

    // Proposal decided exactly once.
    const [decided] = tables.get(capabilityConnectionProposals)!;
    expect(decided!.status).toBe("admitted");
    expect(decided!.decided_by_user_id).toBe(ADMIN);
    expect(decided!.decided_at).toBeInstanceOf(Date);
    expect(decided!.definition_id).toBe(result.definition!.id);

    // Folder projection: CONNECTION.md parses back with the exact U1b
    // capability_ref shadow shape.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tenantId: TENANT,
      klass: "connection",
      slug: "github-rest",
      signedBy: `operator:${ADMIN}`,
      sidecar: { enabled: true, permissions: { operations: ["get-user"] } },
    });
    const parsed = parseConnectionDefinition(
      calls[0]!.definition as string,
      "connections/github-rest/CONNECTION.md",
    );
    expect(parsed.valid).toBe(true);
    if (parsed.valid) {
      expect(parsed.parsed.descriptor_identity).toEqual({
        twcap: formatTwcapRef({
          namespace: "acme",
          class: "connection",
          slug: "github-rest",
          version: "1",
          operationId: "get-user",
          contractHash: operationContractHash(descriptor.operations[0]!),
        }),
        descriptor_fingerprint: descriptorFingerprint(descriptor),
      });
      expect(parsed.parsed.type).toBe("api");
      expect(parsed.parsed.operations).toEqual(["get-user"]);
    }
  });

  it("rejects a reviewed fingerprint that does not match — never a silent re-review", async () => {
    const proposal = proposalRowFor({ descriptor: makeDescriptor() });
    const { db, inserts } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);
    const result = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: "0".repeat(64),
      adminUserId: ADMIN,
      signer,
    });
    expect(result).toEqual({
      outcome: "rejected",
      reason: "fingerprint_mismatch",
    });
    expect(inserts).toHaveLength(0);
    expect(proposal.status).toBe("draft");
  });

  it("rejects when the stored payload no longer matches its stored fingerprint", async () => {
    const proposal = proposalRowFor(
      { descriptor: makeDescriptor() },
      { payload_fingerprint: "0".repeat(64) },
    );
    const { db } = fakeDb([[capabilityConnectionProposals, [proposal]]]);
    const result = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: "0".repeat(64),
      adminUserId: ADMIN,
      signer,
    });
    expect(result.reason).toBe("fingerprint_mismatch");
  });

  it("rejects missing or foreign-tenant proposals and already-decided ones", async () => {
    const foreign = proposalRowFor(
      { descriptor: makeDescriptor() },
      { tenant_id: OTHER_TENANT },
    );
    const decided = proposalRowFor(
      { descriptor: makeDescriptor() },
      { status: "admitted" },
    );
    const { db } = fakeDb([
      [capabilityConnectionProposals, [foreign, decided]],
    ]);

    for (const [proposalId, reason] of [
      [randomUUID(), "proposal_not_found"],
      [foreign.id, "proposal_not_found"],
      [decided.id, "proposal_already_decided"],
    ] as const) {
      const result = await admitConnectionProposal(db, {
        tenantId: TENANT,
        proposalId: proposalId as string,
        reviewedFingerprint: "0".repeat(64),
        adminUserId: ADMIN,
        signer,
      });
      expect(result.outcome).toBe("rejected");
      expect(result.reason).toBe(reason);
    }
  });

  it("rejects payloads without a descriptor, and invalid descriptors with accumulated violations", async () => {
    const noDescriptor = proposalRowFor({ note: "no descriptor here" });
    const invalid = proposalRowFor({
      descriptor: makeDescriptor({
        version: "not-a-number",
        operations: [makeOperation({ effect: "detonate" })],
      }),
    });
    const { db } = fakeDb([
      [capabilityConnectionProposals, [noDescriptor, invalid]],
    ]);

    const missing = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: noDescriptor.id as string,
      reviewedFingerprint: noDescriptor.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(missing.outcome).toBe("rejected");
    expect(missing.reason).toContain("descriptor");

    const bad = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: invalid.id as string,
      reviewedFingerprint: invalid.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(bad.outcome).toBe("rejected");
    expect(bad.reason).toContain("version: must be a decimal string");
    expect(bad.reason).toContain("operations[0].effect: invalid");
  });

  it("reserves the platform namespace for tenant_id-null definitions", async () => {
    const proposal = proposalRowFor({
      descriptor: makeDescriptor({ namespace: "platform" }),
    });
    const { db } = fakeDb([[capabilityConnectionProposals, [proposal]]]);
    const result = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: proposal.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(result.reason).toBe("platform_namespace_reserved");
  });

  it("rejects reuse of a definition owned by another tenant", async () => {
    const proposal = proposalRowFor({ descriptor: makeDescriptor() });
    const { db } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
      [
        capabilityDefinitions,
        [
          {
            id: randomUUID(),
            tenant_id: OTHER_TENANT,
            namespace: "acme",
            class: "connection",
            slug: "github-rest",
            display_name: "GitHub REST",
            status: "active",
          },
        ],
      ],
    ]);
    const result = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: proposal.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(result.reason).toBe("definition_tenant_mismatch");
  });

  it("second admission appends version 2 and leaves version 1 byte-identical", async () => {
    const descriptorV1 = makeDescriptor();
    const descriptorV2 = makeDescriptor({
      version: "2",
      operations: [makeOperation({ summary: "Read the user, refreshed" })],
    });
    const p1 = proposalRowFor({ descriptor: descriptorV1 });
    const p2 = proposalRowFor({ descriptor: descriptorV2 });
    const { db, tables } = fakeDb([[capabilityConnectionProposals, [p1, p2]]]);

    const first = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: p1.id as string,
      reviewedFingerprint: p1.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(first.outcome).toBe("applied");
    const v1Row = tables
      .get(capabilityDefinitionVersions)!
      .find((row) => row.version === 1)!;
    const v1Snapshot = JSON.stringify(v1Row);

    const second = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: p2.id as string,
      reviewedFingerprint: p2.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(second.outcome).toBe("applied");
    expect(second.version!.version).toBe(2);
    expect(second.definition!.id).toBe(first.definition!.id);
    // Immutability: the admitted v1 row did not move by a single byte.
    expect(JSON.stringify(v1Row)).toBe(v1Snapshot);
  });

  it("records a mismatching declared descriptor version in provenance and uses max+1", async () => {
    const proposal = proposalRowFor({
      descriptor: makeDescriptor({ version: "7" }),
    });
    const { db } = fakeDb([[capabilityConnectionProposals, [proposal]]]);
    const result = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: proposal.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    expect(result.outcome).toBe("applied");
    expect(result.version!.version).toBe(1);
    expect(
      (result.version!.provenance_json as Record<string, unknown>)
        .declaredDescriptorVersion,
    ).toBe("7");
  });

  it("a folder-write failure (or throw) yields applied + projection_pending — the version row stays authoritative", async () => {
    for (const writer of [
      recordingWriter({ ok: false, reason: "write_failed" }).writer,
      {
        write: async () => {
          throw new Error("s3 down");
        },
      } satisfies AdmissionFolderWriter,
    ]) {
      const proposal = proposalRowFor({ descriptor: makeDescriptor() });
      const { db, tables } = fakeDb([
        [capabilityConnectionProposals, [proposal]],
      ]);
      const result = await admitConnectionProposal(db, {
        tenantId: TENANT,
        proposalId: proposal.id as string,
        reviewedFingerprint: proposal.payload_fingerprint as string,
        adminUserId: ADMIN,
        signer,
        folderWriter: writer,
      });
      expect(result.outcome).toBe("applied");
      expect(result.reason).toBe("projection_pending");
      expect(tables.get(capabilityDefinitionVersions)).toHaveLength(1);
      expect(result.version!.lifecycle).toBe("admitted");
    }
  });
});

describe("createCandidateVersion (AE3 refresh)", () => {
  async function admittedFixture() {
    const descriptor = makeDescriptor();
    const proposal = proposalRowFor({ descriptor });
    const { db, tables, updates } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);
    const admitted = await admitConnectionProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      reviewedFingerprint: proposal.payload_fingerprint as string,
      adminUserId: ADMIN,
      signer,
    });
    return { db, tables, updates, admitted, descriptor };
  }

  it("refresh inserts a candidate max+1 and leaves the admitted version byte-identical", async () => {
    const { db, tables, updates, admitted } = await admittedFixture();
    const admittedRow = tables
      .get(capabilityDefinitionVersions)!
      .find((row) => row.version === 1)!;
    const snapshot = JSON.stringify(admittedRow);
    const updatesBefore = updates.length;

    const refreshed = makeDescriptor({
      operations: [makeOperation({ summary: "refreshed summary" })],
    });
    const result = await createCandidateVersion(db, {
      tenantId: TENANT,
      definitionId: admitted.definition!.id,
      descriptor: refreshed,
      provenance: { sourceUrls: ["https://docs.github.com/rest"] },
      actor: { type: "agent", id: randomUUID() },
    });

    expect(result.outcome).toBe("applied");
    expect(result.version!.version).toBe(2);
    expect(result.version!.lifecycle).toBe("candidate");
    expect(result.version!.descriptor_fingerprint).toBe(
      descriptorFingerprint(refreshed),
    );
    // Candidates are unsigned until their own admission.
    expect(result.version!.signature_json).toBeUndefined();
    // The admitted row never moves, and refresh issues NO updates at all
    // (grants/bindings untouched by construction).
    expect(JSON.stringify(admittedRow)).toBe(snapshot);
    expect(updates.length).toBe(updatesBefore);
  });

  it("rejects invalid descriptors, unknown definitions, and identity drift", async () => {
    const { db, admitted } = await admittedFixture();

    const invalid = await createCandidateVersion(db, {
      tenantId: TENANT,
      definitionId: admitted.definition!.id,
      descriptor: { nope: true },
      provenance: {},
      actor: { type: "system" },
    });
    expect(invalid.outcome).toBe("rejected");

    const missing = await createCandidateVersion(db, {
      tenantId: TENANT,
      definitionId: randomUUID(),
      descriptor: makeDescriptor(),
      provenance: {},
      actor: { type: "system" },
    });
    expect(missing.reason).toBe("definition_not_found");

    const foreignTenant = await createCandidateVersion(db, {
      tenantId: OTHER_TENANT,
      definitionId: admitted.definition!.id,
      descriptor: makeDescriptor(),
      provenance: {},
      actor: { type: "system" },
    });
    expect(foreignTenant.reason).toBe("definition_not_found");

    const drifted = await createCandidateVersion(db, {
      tenantId: TENANT,
      definitionId: admitted.definition!.id,
      descriptor: makeDescriptor({ slug: "github-mcp" }),
      provenance: {},
      actor: { type: "system" },
    });
    expect(drifted.reason).toBe("descriptor_identity_mismatch");
  });
});

describe("connectionDefinitionFromDescriptor", () => {
  it("lists every operation's twcap reference in the body", () => {
    const descriptor = makeDescriptor({
      operations: [
        makeOperation(),
        makeOperation({ operationId: "list-repos", summary: "List repos" }),
      ],
    });
    const contractHashes = Object.fromEntries(
      descriptor.operations.map((op) => [
        op.operationId,
        operationContractHash(op),
      ]),
    );
    const definition = connectionDefinitionFromDescriptor({
      descriptor,
      finalVersion: 3,
      fingerprint: descriptorFingerprint(descriptor),
      contractHashes,
    });
    for (const op of descriptor.operations) {
      expect(definition).toContain(
        formatTwcapRef({
          namespace: descriptor.namespace,
          class: descriptor.class,
          slug: descriptor.slug,
          version: "3",
          operationId: op.operationId,
          contractHash: contractHashes[op.operationId]!,
        }),
      );
    }
    const parsed = parseConnectionDefinition(definition, "x/CONNECTION.md");
    expect(parsed.valid).toBe(true);
  });
});

describe("autonomouslyAdmitProposal (self-extension)", () => {
  const AGENT = randomUUID();

  // An auto-tier descriptor: public read, no credential, reversible, classified.
  function autoDescriptor(overrides: Row = {}): CapabilityDescriptor {
    return makeDescriptor({
      slug: "github-rest-public",
      bindingRequirements: { credentialKinds: [], principalModes: ["service"] },
      operations: [
        makeOperation({ inputDataClass: "public", outputDataClass: "public" }),
      ],
      ...overrides,
    });
  }

  it("self-admits an auto-tier descriptor with autonomous provenance (no human)", async () => {
    const descriptor = autoDescriptor();
    const payload = { descriptor, displayName: "GitHub public" };
    const proposal = proposalRowFor(payload);
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
    });

    expect(result.outcome).toBe("applied");
    const versions = tables.get(capabilityDefinitionVersions)!;
    expect(versions).toHaveLength(1);
    expect(versions[0].admission_mode).toBe("autonomous");
    expect(versions[0].admitted_by_agent_id).toBe(AGENT);
    expect(versions[0].admitted_by_user_id).toBeNull();
    // Signature provenance is autonomous, and verifies.
    expect(versions[0].signature_json.signed_by).toBe(`autonomous:${AGENT}`);
    expect(
      verifier.verifyPayload(
        descriptor as unknown as Record<string, unknown>,
        versions[0].signature_json,
      ),
    ).toBe(true);
    // The definition carries no operator author.
    const defs = tables.get(capabilityDefinitions)!;
    expect(defs[0].created_by_user_id).toBeNull();
  });

  it("records a capability_approvals binding when registry-trust is ON (THINK-302 U8)", async () => {
    const descriptor = autoDescriptor();
    const proposal = proposalRowFor({ descriptor });
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
      // Flag ON for this tenant.
      [tenants, [{ id: TENANT, capability_registry_trust: true }]],
    ]);
    const writer = recordingWriter({ ok: true });

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
      folderWriter: writer.writer,
    });

    expect(result.outcome).toBe("applied");
    const bindings = tables.get(capabilityApprovals) ?? [];
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      tenant_id: TENANT,
      scope_ref: `agent:${AGENT}`,
      class: "connection",
      slug: "github-rest-public",
      signed_by: `autonomous:${AGENT}`,
    });
  });

  it("records NO binding when registry-trust is OFF (legacy sidecar seam)", async () => {
    const descriptor = autoDescriptor();
    const proposal = proposalRowFor({ descriptor });
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
      [tenants, [{ id: TENANT, capability_registry_trust: false }]],
    ]);
    const writer = recordingWriter({ ok: true });

    await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
      folderWriter: writer.writer,
    });

    expect(tables.get(capabilityApprovals) ?? []).toHaveLength(0);
  });

  it("auto-provisions a ready binding when a provisioner is supplied (U2b)", async () => {
    const descriptor = autoDescriptor();
    const proposal = proposalRowFor({ descriptor });
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
      provisioner: {
        probeRunner: { probe: async () => ({ ok: true, statusCode: 200 }) },
        secretResolver: { resolve: async () => ({}) },
      },
    });

    expect(result.outcome).toBe("applied");
    // The self-admitted public capability is now runnable: SP + ready binding.
    expect(result.binding?.outcome).toBe("ready");
    expect(result.binding?.binding?.readiness).toBe("ready");
    expect(result.binding?.servicePrincipalId).toBeTruthy();
    expect(tables.get(tenantServicePrincipals) ?? []).toHaveLength(1);
  });

  it("omitting the provisioner admits only (no binding side-effect)", async () => {
    const descriptor = autoDescriptor();
    const proposal = proposalRowFor({ descriptor });
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
    });

    expect(result.outcome).toBe("applied");
    expect(result.binding).toBeUndefined();
    expect(tables.get(tenantServicePrincipals) ?? []).toHaveLength(0);
  });

  it("holds a credentialed descriptor for operator review (does not self-admit)", async () => {
    // makeDescriptor default requires credentialKinds ['api_key'] → review tier.
    const descriptor = makeDescriptor();
    const payload = { descriptor };
    const proposal = proposalRowFor(payload);
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
    });

    expect(result.outcome).toBe("held_for_review");
    expect(tables.get(capabilityDefinitionVersions) ?? []).toHaveLength(0);
    // The proposal is left undecided for the operator.
    expect(proposal.status).toBe("draft");
  });

  it("holds a write operation for operator review", async () => {
    const descriptor = autoDescriptor({
      operations: [
        makeOperation({
          operationId: "issues.create",
          effect: "create",
          inputDataClass: "public",
          outputDataClass: "public",
        }),
      ],
    });
    const proposal = proposalRowFor({ descriptor });
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
    });

    expect(result.outcome).toBe("held_for_review");
    expect(tables.get(capabilityDefinitionVersions) ?? []).toHaveLength(0);
  });

  it("holds a descriptor with an unclassified (forbidden) operation for review", async () => {
    const descriptor = autoDescriptor({
      operations: [
        makeOperation({
          inputDataClass: "public",
          outputDataClass: "public",
          costClass: "unknown",
        }),
      ],
    });
    const proposal = proposalRowFor({ descriptor });
    const { db, tables } = fakeDb([
      [capabilityConnectionProposals, [proposal]],
    ]);

    const result = await autonomouslyAdmitProposal(db, {
      tenantId: TENANT,
      proposalId: proposal.id as string,
      agentId: AGENT,
      signer,
    });

    expect(result.outcome).toBe("held_for_review");
    expect(tables.get(capabilityDefinitionVersions) ?? []).toHaveLength(0);
  });
});
