/**
 * Routine promotion control-plane tests (THINK-280 U6 — R13, R14, R15, R18;
 * AE6, AE7). DB mocked at the drizzle-operator seam (research.test.ts
 * convention): real schema tables key the store, mocked operators produce
 * introspectable conditions, the injected fake db applies them. The
 * promoter is an injected fake — no Git, no AWS.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  or: (...args: unknown[]) => ({ _or: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  isNull: (col: unknown) => ({ _isNull: col }),
  ilike: (col: unknown, val: unknown) => ({ _ilike: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ _inArray: [col, vals] }),
  desc: () => ({}),
  asc: () => ({}),
  sql: Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) }),
  relations: () => ({}),
}));

import {
  capabilityDefinitionVersions,
  capabilityRoutineProposals,
  inboxItems,
} from "@thinkwork/database-pg/schema";
import { canonicalSha256Hex } from "@thinkwork/capability-contracts";
import {
  approveRoutineProposal,
  createRoutineProposal,
  evaluateRepairDiff,
  normalizePython,
  publishRepairProposal,
  rejectRoutineProposal,
  type Db,
  type RoutineProposalBundle,
  type RoutineProposalPromoter,
  type RoutinePromotionResult,
} from "./routine-proposal.js";

// ── fake db ──────────────────────────────────────────────────────────────

type Row = Record<string, any>;

function colName(col: unknown): string | null {
  return col && typeof col === "object" && typeof (col as any).name === "string"
    ? (col as any).name
    : null;
}

function rowMatches(row: Row, cond: unknown): boolean {
  if (!cond || typeof cond !== "object") return true;
  const c = cond as any;
  if (c._and) return c._and.every((child: unknown) => rowMatches(row, child));
  if (c._or) return c._or.some((child: unknown) => rowMatches(row, child));
  if (c._eq) {
    const name = colName(c._eq[0]);
    return name ? row[name] === c._eq[1] : true;
  }
  if (c._inArray) {
    const name = colName(c._inArray[0]);
    return name ? (c._inArray[1] as unknown[]).includes(row[name]) : true;
  }
  if (c._isNull !== undefined) {
    const name = colName(c._isNull);
    return name ? row[name] == null : true;
  }
  return true;
}

function fakeDb(seed: Array<[unknown, Row[]]> = []) {
  const tables = new Map<unknown, Row[]>(seed);
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
      values: (v: Row) => {
        const make = () => {
          const row: Row = { id: randomUUID(), created_at: new Date(), ...v };
          rowsFor(t).push(row);
          return row;
        };
        return {
          returning: (_sel?: unknown) => Promise.resolve([make()]),
          then: (onF: any, onR: any) =>
            Promise.resolve(make()).then(() => onF(undefined), onR),
        };
      },
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
  return { db: db as Db, tables, rowsFor };
}

const TENANT = randomUUID();
const ADMIN = randomUUID();
const DEF_VERSION = randomUUID();
const SERVICE_PRINCIPAL = randomUUID();
const CONTRACT_HASH = "a".repeat(64);
const TWCAP = `twcap://acme/connection/github-rest@1/repos.get#sha256:${CONTRACT_HASH}`;

function admittedVersionRow(overrides: Row = {}): Row {
  return {
    id: DEF_VERSION,
    definition_id: randomUUID(),
    version: 1,
    lifecycle: "admitted",
    contract_hashes_json: { "repos.get": CONTRACT_HASH },
    ...overrides,
  };
}

function baseBundle(
  overrides: Partial<RoutineProposalBundle> = {},
): RoutineProposalBundle {
  return {
    slug: "issue-health",
    code: "def run(input):\n    return {'ok': True}\n",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    fixtures: [
      { path: "fixtures/00.json", input: { n: 1 }, expected: { ok: true } },
    ],
    invariants: [],
    dependencies: [
      {
        twcap: TWCAP,
        contractHash: CONTRACT_HASH,
        definitionVersionId: DEF_VERSION,
      },
    ],
    minimumGrants: null,
    principal: { mode: "service", servicePrincipalId: SERVICE_PRINCIPAL },
    effectSummary: { effect: "read", budgets: { pageSize: 50 } },
    evidence: { brokerSessionId: "broker-session-1", brokerCallIds: [] },
    ...overrides,
  };
}

const okPromoter = (
  result: RoutinePromotionResult,
): RoutineProposalPromoter => ({
  promote: vi.fn(async () => result),
});

// ── normalizePython ────────────────────────────────────────────────────────

describe("normalizePython", () => {
  it("normalizes line endings + trailing whitespace to a single trailing newline", () => {
    expect(normalizePython("a  \r\n b\t\n\n\n")).toBe("a\n b\n");
  });
  it("is idempotent (stable fingerprint)", () => {
    const once = normalizePython("def run(x):\r\n    return x\n\n");
    expect(normalizePython(once)).toBe(once);
  });
});

// ── createRoutineProposal ───────────────────────────────────────────────────

describe("createRoutineProposal", () => {
  it("persists a submitted proposal with a canonical fingerprint (no Git/exec)", async () => {
    const { db, rowsFor } = fakeDb([
      [capabilityDefinitionVersions, [admittedVersionRow()]],
    ]);
    const res = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle(),
      status: "submitted",
      actor: { type: "agent", id: randomUUID() },
    });
    expect(res.outcome).toBe("applied");
    expect(res.proposal!.status).toBe("submitted");
    expect(res.proposal!.payload_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    // fingerprint == canonical hash of the stored immutable payload
    expect(res.proposal!.payload_fingerprint).toBe(
      canonicalSha256Hex(res.proposal!.payload_json),
    );
    // No routine / cache / commit rows written by creation.
    expect(rowsFor(capabilityRoutineProposals).length).toBe(1);
  });

  it("sanitizes fixtures against declared secret sources before persistence", async () => {
    const { db } = fakeDb([
      [capabilityDefinitionVersions, [admittedVersionRow()]],
    ]);
    const secret = "ghp_" + "x".repeat(36);
    const res = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle({
        fixtures: [
          {
            path: "fixtures/00.json",
            input: { token: secret },
            expected: { ok: true },
          },
        ],
      }),
      secretSources: [{ token: secret }],
      actor: { type: "agent", id: randomUUID() },
    });
    expect(res.outcome).toBe("applied");
    const stored = JSON.stringify(res.proposal!.payload_json);
    expect(stored).not.toContain(secret);
    expect(stored).toContain("<redacted>");
  });

  it("fails closed on an undeclared secret-shaped fixture value", async () => {
    const { db } = fakeDb([
      [capabilityDefinitionVersions, [admittedVersionRow()]],
    ]);
    const res = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle({
        fixtures: [
          {
            path: "fixtures/00.json",
            input: { token: "ghp_" + "z".repeat(36) },
            expected: { ok: true },
          },
        ],
      }),
      secretSources: [], // secret NOT declared → residual token shape
      actor: { type: "agent", id: randomUUID() },
    });
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toContain("unsanitized_fixture");
  });

  it("rejects a dependency that is not an admitted capability version", async () => {
    const { db } = fakeDb([[capabilityDefinitionVersions, []]]);
    const res = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle(),
      actor: { type: "agent", id: randomUUID() },
    });
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toContain("dependency_not_admitted");
  });

  it("rejects a dependency contract hash absent from the admitted version", async () => {
    const { db } = fakeDb([
      [
        capabilityDefinitionVersions,
        [
          admittedVersionRow({
            contract_hashes_json: { "repos.get": "b".repeat(64) },
          }),
        ],
      ],
    ]);
    const res = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle(),
      actor: { type: "agent", id: randomUUID() },
    });
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toContain("dependency_contract_mismatch");
  });

  it("supersedes a prior open proposal for the same new-routine slug (AE6)", async () => {
    const { db, rowsFor } = fakeDb([
      [capabilityDefinitionVersions, [admittedVersionRow()]],
    ]);
    const first = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle(),
      status: "submitted",
      actor: { type: "agent", id: randomUUID() },
    });
    const second = await createRoutineProposal(db, {
      tenantId: TENANT,
      bundle: baseBundle({
        code: "def run(input):\n    return {'ok': False}\n",
      }),
      status: "submitted",
      actor: { type: "agent", id: randomUUID() },
    });
    const rows = rowsFor(capabilityRoutineProposals);
    const firstRow = rows.find((r) => r.id === first.proposal!.id);
    expect(firstRow!.status).toBe("superseded");
    expect(second.proposal!.status).toBe("submitted");
    expect(second.proposal!.payload_fingerprint).not.toBe(
      first.proposal!.payload_fingerprint,
    );
  });
});

// ── approveRoutineProposal (exact single-use + AE6) ─────────────────────────

describe("approveRoutineProposal", () => {
  function seedSubmitted() {
    const store = fakeDb([
      [capabilityDefinitionVersions, [admittedVersionRow()]],
    ]);
    const fingerprint = "f".repeat(64);
    store.rowsFor(capabilityRoutineProposals).push({
      id: "prop-1",
      tenant_id: TENANT,
      routine_id: null,
      payload_json: baseBundle(),
      payload_fingerprint: fingerprint,
      evidence_refs_json: {},
      status: "submitted",
      approval_mode: null,
      approval_evidence_json: {},
      created_at: new Date(),
    });
    return { ...store, fingerprint };
  }

  it("commits + promotes on exact fingerprint, marking the row promoted", async () => {
    const { db, rowsFor, fingerprint } = seedSubmitted();
    const promoter = okPromoter({
      outcome: "promoted",
      commitSha: "deadbeef",
      validatedSha: "deadbeef",
      hermetic: {
        status: "green",
        fixtures: [{ path: "fixtures/00.json", passed: true }],
      },
    });
    const res = await approveRoutineProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "prop-1",
        reviewedFingerprint: fingerprint,
        adminUserId: ADMIN,
      },
      { promoter },
    );
    expect(res.outcome).toBe("applied");
    expect(res.promotion!.outcome).toBe("promoted");
    const row = rowsFor(capabilityRoutineProposals).find(
      (r) => r.id === "prop-1",
    );
    expect(row!.status).toBe("promoted");
    expect(row!.approval_mode).toBe("operator");
    expect(row!.promoted_commit_sha).toBe("deadbeef");
    expect(row!.decided_by_user_id).toBe(ADMIN);
    // Inbox linkage recorded.
    expect(rowsFor(inboxItems).length).toBe(1);
    expect(row!.inbox_item_id).toBe(rowsFor(inboxItems)[0].id);
  });

  it("fails closed on a stale fingerprint — no commit, no activation (AE6)", async () => {
    const { db, rowsFor } = seedSubmitted();
    const promoter = okPromoter({ outcome: "promoted", commitSha: "x" });
    const res = await approveRoutineProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "prop-1",
        reviewedFingerprint: "0".repeat(64),
        adminUserId: ADMIN,
      },
      { promoter },
    );
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toBe("stale_or_decided_fingerprint");
    expect(promoter.promote).not.toHaveBeenCalled();
    const row = rowsFor(capabilityRoutineProposals).find(
      (r) => r.id === "prop-1",
    );
    expect(row!.status).toBe("submitted"); // untouched
  });

  it("is single-use: a second approve of the same fingerprint matches 0 rows", async () => {
    const { db, fingerprint } = seedSubmitted();
    const promoter = okPromoter({ outcome: "promoted", commitSha: "sha" });
    const first = await approveRoutineProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "prop-1",
        reviewedFingerprint: fingerprint,
        adminUserId: ADMIN,
      },
      { promoter },
    );
    const second = await approveRoutineProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "prop-1",
        reviewedFingerprint: fingerprint,
        adminUserId: ADMIN,
      },
      { promoter },
    );
    expect(first.outcome).toBe("applied");
    expect(second.outcome).toBe("rejected");
    expect(second.reason).toBe("stale_or_decided_fingerprint");
    expect(promoter.promote).toHaveBeenCalledTimes(1);
  });

  it("leaves the row 'approved' (candidate) when hermetic validation fails — no promotion", async () => {
    const { db, rowsFor, fingerprint } = seedSubmitted();
    const promoter = okPromoter({
      outcome: "validation_failed",
      commitSha: "sha",
      hermetic: {
        status: "red",
        fixtures: [
          { path: "fixtures/00.json", passed: false, detail: "mismatch" },
        ],
      },
      reason: "hermetic fixture gate was red",
    });
    const res = await approveRoutineProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "prop-1",
        reviewedFingerprint: fingerprint,
        adminUserId: ADMIN,
      },
      { promoter },
    );
    expect(res.outcome).toBe("applied");
    expect(res.promotion!.outcome).toBe("validation_failed");
    const row = rowsFor(capabilityRoutineProposals).find(
      (r) => r.id === "prop-1",
    );
    expect(row!.status).toBe("approved");
    expect(row!.promoted_commit_sha ?? null).toBeNull();
    expect(row!.approval_evidence_json.promotionOutcome).toBe(
      "validation_failed",
    );
  });
});

// ── rejectRoutineProposal ───────────────────────────────────────────────────

describe("rejectRoutineProposal", () => {
  it("rejects a submitted proposal", async () => {
    const { db, rowsFor } = fakeDb();
    rowsFor(capabilityRoutineProposals).push({
      id: "p",
      tenant_id: TENANT,
      status: "submitted",
      payload_json: {},
    });
    const res = await rejectRoutineProposal(db, {
      tenantId: TENANT,
      proposalId: "p",
      adminUserId: ADMIN,
    });
    expect(res.outcome).toBe("applied");
    expect(rowsFor(capabilityRoutineProposals)[0].status).toBe("rejected");
  });

  it("rejects an approved-but-not-promoted proposal (kill a bad autonomous approval)", async () => {
    const { db, rowsFor } = fakeDb();
    rowsFor(capabilityRoutineProposals).push({
      id: "p",
      tenant_id: TENANT,
      status: "approved",
      promoted_commit_sha: null,
      approval_mode: "autonomous",
      payload_json: {},
    });
    const res = await rejectRoutineProposal(db, {
      tenantId: TENANT,
      proposalId: "p",
      adminUserId: ADMIN,
    });
    expect(res.outcome).toBe("applied");
    expect(rowsFor(capabilityRoutineProposals)[0].status).toBe("rejected");
  });

  it("will not reject an approved proposal whose commit promoted", async () => {
    const { db, rowsFor } = fakeDb();
    rowsFor(capabilityRoutineProposals).push({
      id: "p",
      tenant_id: TENANT,
      status: "approved",
      promoted_commit_sha: "abc123",
      payload_json: {},
    });
    const res = await rejectRoutineProposal(db, {
      tenantId: TENANT,
      proposalId: "p",
      adminUserId: ADMIN,
    });
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toBe("proposal_already_decided");
    expect(rowsFor(capabilityRoutineProposals)[0].status).toBe("approved");
  });

  it("will not re-decide an already-promoted proposal", async () => {
    const { db, rowsFor } = fakeDb();
    rowsFor(capabilityRoutineProposals).push({
      id: "p",
      tenant_id: TENANT,
      status: "promoted",
      payload_json: {},
    });
    const res = await rejectRoutineProposal(db, {
      tenantId: TENANT,
      proposalId: "p",
      adminUserId: ADMIN,
    });
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toBe("proposal_already_decided");
  });
});

// ── repair auto-publish (R14/AE6 sole exception) ────────────────────────────

describe("evaluateRepairDiff", () => {
  it("auto-publishes a narrowing budget change (unchanged deps/principals/effects)", () => {
    const prior = baseBundle();
    const next = baseBundle({
      effectSummary: { effect: "read", budgets: { pageSize: 25 } },
    });
    const diff = evaluateRepairDiff(prior, next);
    expect(diff.autoPublish).toBe(true);
    expect(diff.fields.find((f) => f.field === "budgets")!.verdict).toBe(
      "narrower",
    );
  });

  it("never auto-publishes a higher budget (expansion → fresh proposal)", () => {
    const prior = baseBundle();
    const next = baseBundle({
      effectSummary: { effect: "read", budgets: { pageSize: 100 } },
    });
    const diff = evaluateRepairDiff(prior, next);
    expect(diff.autoPublish).toBe(false);
    expect(diff.expansions).toContain("budgets");
  });

  it("never auto-publishes a new dependency, principal change, or widened effect", () => {
    const prior = baseBundle();
    expect(
      evaluateRepairDiff(
        prior,
        baseBundle({
          dependencies: [
            ...prior.dependencies,
            { twcap: "twcap://x", contractHash: "c", definitionVersionId: "d" },
          ],
        }),
      ).expansions,
    ).toContain("dependencies");
    expect(
      evaluateRepairDiff(
        prior,
        baseBundle({ principal: { mode: "requester" } }),
      ).expansions,
    ).toContain("principal");
    expect(
      evaluateRepairDiff(
        prior,
        baseBundle({ effectSummary: { effect: "update" } }),
      ).expansions,
    ).toContain("effect");
  });
});

describe("publishRepairProposal", () => {
  function seedRepair(nextBundle: RoutineProposalBundle) {
    const store = fakeDb([
      [capabilityDefinitionVersions, [admittedVersionRow()]],
    ]);
    const fingerprint = "e".repeat(64);
    store.rowsFor(capabilityRoutineProposals).push({
      id: "rep-1",
      tenant_id: TENANT,
      routine_id: null,
      payload_json: nextBundle,
      payload_fingerprint: fingerprint,
      evidence_refs_json: {},
      status: "submitted",
      approval_mode: null,
      approval_evidence_json: {},
      created_at: new Date(),
    });
    return { ...store, fingerprint };
  }

  it("machine-approves a narrow diff (approval_mode='repair', decided_by NULL, diff evidence)", async () => {
    const prior = baseBundle();
    const next = baseBundle({
      effectSummary: { effect: "read", budgets: { pageSize: 10 } },
    });
    const { db, rowsFor, fingerprint } = seedRepair(next);
    const promoter = okPromoter({
      outcome: "promoted",
      commitSha: "repairsha",
      validatedSha: "repairsha",
    });
    const res = await publishRepairProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "rep-1",
        reviewedFingerprint: fingerprint,
        priorBundle: prior,
      },
      { promoter },
    );
    expect(res.outcome).toBe("applied");
    const row = rowsFor(capabilityRoutineProposals).find(
      (r) => r.id === "rep-1",
    );
    expect(row!.status).toBe("promoted");
    expect(row!.approval_mode).toBe("repair");
    expect(row!.decided_by_user_id ?? null).toBeNull();
    expect(row!.approval_evidence_json.diff).toBeTruthy();
  });

  it("refuses to auto-publish an expansion — a fresh operator proposal owns it", async () => {
    const prior = baseBundle();
    const next = baseBundle({ effectSummary: { effect: "update" } });
    const { db, fingerprint } = seedRepair(next);
    const promoter = okPromoter({ outcome: "promoted", commitSha: "x" });
    const res = await publishRepairProposal(
      db,
      {
        tenantId: TENANT,
        proposalId: "rep-1",
        reviewedFingerprint: fingerprint,
        priorBundle: prior,
      },
      { promoter },
    );
    expect(res.outcome).toBe("rejected");
    expect(res.reason).toContain("repair_expansion_requires_operator");
    expect(promoter.promote).not.toHaveBeenCalled();
  });
});
