import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@thinkwork/database-pg";

// Claim-lifecycle tests run upsertClaimsForEvidence for REAL against an
// in-memory fake db: only drizzle's comparison builders are swapped for
// plain descriptor objects the fake interprets (see fake-claims-db.ts).
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  ...(await import("./test-support/drizzle-condition-mocks.js"))
    .drizzleConditionMocks,
}));

import {
  buildClaimProjection,
  extractCompanyClaims,
  SINGLE_VALUED_PREDICATES,
  upsertClaimsForEvidence,
} from "./claims.js";
import {
  makeFakeMemoryDb,
  retractSupportEdges,
  type FakeMemoryStore,
} from "./test-support/fake-claims-db.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../docs/solutions/fixtures/think-193-u1-twenty-dossier-fixture.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  evidence: { sourceItemId: string };
  normalizedSnapshot: Record<string, unknown>;
};

function extractFixtureClaims() {
  return extractCompanyClaims({
    snapshot: fixture.normalizedSnapshot,
    sourceItemId: fixture.evidence.sourceItemId,
    targetScope: "tenant",
    targetId: TENANT_ID,
  });
}

describe("extractCompanyClaims (fixture round-trip)", () => {
  it("extracts provider-neutral claims from the real sanitized snapshot", () => {
    const claims = extractFixtureClaims();
    expect(claims.length).toBeGreaterThanOrEqual(3);

    const name = claims.find((c) => c.ontologyPredicate === "customer.name");
    expect(name?.value).toEqual({ text: "Acme Probe (THINK-193 U1)" });

    const employees = claims.find(
      (c) => c.ontologyPredicate === "customer.employees",
    );
    expect(employees?.value).toEqual({ count: 77 });

    for (const claim of claims) {
      // Provider-NEUTRAL predicate slugs: nothing twenty-specific.
      expect(claim.ontologyPredicate).toMatch(/^customer\./);
      expect(claim.subjectKey).toBe(
        `twenty:company:${fixture.evidence.sourceItemId}`,
      );
      expect(claim.subjectEntityType).toBe("customer");
      expect(claim.extractionVersion).toBe("u2.1");
      expect(claim.valueHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("produces a stable value_hash across two runs", () => {
    const first = extractFixtureClaims().map((c) => c.valueHash);
    const second = extractFixtureClaims().map((c) => c.valueHash);
    expect(first).toEqual(second);
  });

  it("sets effective_from from the company updatedAt", () => {
    const claims = extractFixtureClaims();
    for (const claim of claims) {
      expect(claim.effectiveFrom).toEqual(new Date("2026-07-12T01:55:56.951Z"));
    }
  });
});

describe("extractCompanyClaims (rich snapshot)", () => {
  const richSnapshot: Record<string, unknown> = {
    id: "co-1",
    name: "Globex",
    domainName: "https://globex.example",
    employees: 12,
    annualRecurringRevenue: {
      amountMicros: 5_000_000_000,
      currencyCode: "USD",
    },
    address: {
      addressStreet1: "1 Main St",
      addressStreet2: "",
      addressCity: "Springfield",
    },
    updatedAt: "2026-07-01T00:00:00.000Z",
    people: [
      {
        id: "p-1",
        name: "Ada Lovelace",
        jobTitle: "CTO",
        email: "ada@globex.example",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      { id: "p-2" },
    ],
    opportunities: [
      {
        id: "o-1",
        name: "Renewal",
        stage: "PROPOSAL",
        amount: { amountMicros: 1_000_000, currencyCode: "USD" },
        closeDate: "2026-09-01",
      },
    ],
    notes: [{ id: "n-1", title: "Kickoff", body: "Went well.\nNext steps…" }],
  };

  function extract() {
    return extractCompanyClaims({
      snapshot: richSnapshot,
      sourceItemId: "co-1",
      targetScope: "space",
      targetId: "space-1",
    });
  }

  it("emits one claim per predicate/relation item with expected values", () => {
    const claims = extract();
    const byPredicate = new Map<string, typeof claims>();
    for (const claim of claims) {
      const list = byPredicate.get(claim.ontologyPredicate) ?? [];
      list.push(claim);
      byPredicate.set(claim.ontologyPredicate, list);
    }
    expect(byPredicate.get("customer.name")?.[0]?.value).toEqual({
      text: "Globex",
    });
    expect(byPredicate.get("customer.domain")?.[0]?.value).toEqual({
      url: "https://globex.example",
    });
    expect(byPredicate.get("customer.employees")?.[0]?.value).toEqual({
      count: 12,
    });
    expect(
      byPredicate.get("customer.annual_recurring_revenue")?.[0]?.value,
    ).toEqual({ amountMicros: 5_000_000_000, currencyCode: "USD" });
    // Empty-string address fields are dropped.
    expect(byPredicate.get("customer.address")?.[0]?.value).toEqual({
      addressStreet1: "1 Main St",
      addressCity: "Springfield",
    });
    expect(byPredicate.get("customer.person")).toHaveLength(2);
    expect(byPredicate.get("customer.person")?.[0]?.value).toEqual({
      externalId: "p-1",
      name: "Ada Lovelace",
      jobTitle: "CTO",
      email: "ada@globex.example",
    });
    expect(byPredicate.get("customer.opportunity")?.[0]?.value).toEqual({
      externalId: "o-1",
      name: "Renewal",
      stage: "PROPOSAL",
      amount: { amountMicros: 1_000_000, currencyCode: "USD" },
      closeDate: "2026-09-01",
    });
    expect(byPredicate.get("customer.note")?.[0]?.value).toEqual({
      externalId: "n-1",
      title: "Kickoff",
      body: "Went well.\nNext steps…",
    });
  });

  it("uses item-level updatedAt for relation claims, falling back to company", () => {
    const claims = extract();
    const people = claims.filter(
      (c) => c.ontologyPredicate === "customer.person",
    );
    const withOwnTimestamp = people.find(
      (c) => (c.value as { externalId?: string }).externalId === "p-1",
    );
    const withoutOwnTimestamp = people.find(
      (c) => (c.value as { externalId?: string }).externalId === "p-2",
    );
    expect(withOwnTimestamp?.effectiveFrom).toEqual(
      new Date("2026-07-02T00:00:00.000Z"),
    );
    expect(withoutOwnTimestamp?.effectiveFrom).toEqual(
      new Date("2026-07-01T00:00:00.000Z"),
    );
  });

  it("honors an explicit extractionVersion", () => {
    const claims = extractCompanyClaims({
      snapshot: richSnapshot,
      sourceItemId: "co-1",
      targetScope: "tenant",
      targetId: TENANT_ID,
      extractionVersion: "u2.test",
    });
    expect(claims.every((c) => c.extractionVersion === "u2.test")).toBe(true);
  });
});

describe("extractCompanyClaims (skip-empty discipline)", () => {
  it("emits nothing for an empty snapshot", () => {
    expect(
      extractCompanyClaims({
        snapshot: {},
        sourceItemId: "co-x",
        targetScope: "tenant",
        targetId: TENANT_ID,
      }),
    ).toEqual([]);
  });

  it("skips an address whose fields are all empty strings", () => {
    const claims = extractCompanyClaims({
      snapshot: {
        id: "co-x",
        name: "Empty Addr Co",
        address: { addressCity: "", addressCountry: "" },
      },
      sourceItemId: "co-x",
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(claims.some((c) => c.ontologyPredicate === "customer.address")).toBe(
      false,
    );
  });

  it("skips relation items without an id and yields null effective_from for unparseable dates", () => {
    const claims = extractCompanyClaims({
      snapshot: {
        id: "co-x",
        name: "Odd Co",
        updatedAt: "not-a-date",
        people: [{ name: "No Id" }],
      },
      sourceItemId: "co-x",
      targetScope: "tenant",
      targetId: TENANT_ID,
    });
    expect(claims.some((c) => c.ontologyPredicate === "customer.person")).toBe(
      false,
    );
    const name = claims.find((c) => c.ontologyPredicate === "customer.name");
    expect(name?.effectiveFrom).toBeNull();
  });
});

describe("SINGLE_VALUED_PREDICATES", () => {
  it("covers exactly the overview predicates", () => {
    expect([...SINGLE_VALUED_PREDICATES].sort()).toEqual(
      [
        "customer.address",
        "customer.annual_recurring_revenue",
        "customer.domain",
        "customer.employees",
        "customer.name",
      ].sort(),
    );
  });
});

describe("buildClaimProjection", () => {
  const projClaims = [
    {
      id: "claim-emp",
      ontologyPredicate: "customer.employees",
      value: { count: 77 },
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    },
    {
      id: "claim-name",
      ontologyPredicate: "customer.name",
      value: { text: "Acme\nProbe" },
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
    },
    {
      id: "claim-p1",
      ontologyPredicate: "customer.person",
      value: { externalId: "p-1", name: "Ada", jobTitle: "CTO" },
      effectiveFrom: null,
    },
    {
      id: "claim-n1",
      ontologyPredicate: "customer.note",
      value: { externalId: "n-1", title: "Kickoff", body: "line1\nline2" },
      effectiveFrom: null,
    },
  ];

  it("is deterministic regardless of input order", () => {
    const a = buildClaimProjection(projClaims, {
      title: "Acme",
      subjectKey: "twenty:company:co-1",
    });
    const b = buildClaimProjection([...projClaims].reverse(), {
      title: "Acme",
      subjectKey: "twenty:company:co-1",
    });
    expect(a.markdown).toBe(b.markdown);
  });

  it("embeds claim ids in HTML comments and flattens newlines", () => {
    const { markdown } = buildClaimProjection(projClaims, {
      title: "Acme",
      subjectKey: "twenty:company:co-1",
    });
    expect(markdown).toContain("<!-- claim:claim-name -->");
    expect(markdown).toContain("<!-- claim:claim-emp -->");
    expect(markdown).toContain("<!-- claim:claim-p1 -->");
    expect(markdown).toContain("<!-- claim:claim-n1 -->");
    // Interpolated strings must not inject markdown structure.
    expect(markdown).toContain("Acme Probe");
    expect(markdown).toContain("line1 line2");
    expect(markdown).not.toContain("Acme\nProbe");
  });

  it("orders overview single-valued lines before People/Notes sections", () => {
    const { markdown } = buildClaimProjection(projClaims, {
      title: "Acme",
      subjectKey: "twenty:company:co-1",
    });
    const overviewAt = markdown.indexOf("## Overview");
    const peopleAt = markdown.indexOf("## People");
    const notesAt = markdown.indexOf("## Notes");
    expect(overviewAt).toBeGreaterThanOrEqual(0);
    expect(peopleAt).toBeGreaterThan(overviewAt);
    expect(notesAt).toBeGreaterThan(peopleAt);
    expect(markdown.startsWith("# Acme")).toBe(true);
    expect(markdown).toContain("twenty:company:co-1");
  });
});

// ---------------------------------------------------------------------------
// upsertClaimsForEvidence — claim-lifecycle regression suite (THINK-193 U2,
// semantics fixed after Codex review). These run the REAL function against
// the in-memory fake db.
// ---------------------------------------------------------------------------

const SOURCE_CONFIG_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const SUBJECT_KEY = "twenty:company:co-1";
const T1 = "2026-07-01T00:00:00.000Z";
const T2 = "2026-07-02T00:00:00.000Z";
const T3 = "2026-07-03T00:00:00.000Z";

/**
 * Apply one evidence edition the way runProject does: optionally retract the
 * superseded edition's support edges first (that is what recordAcquiredPage
 * did at acquire time), then upsert the claims extracted from the snapshot.
 */
async function applyEdition(
  db: Database,
  store: FakeMemoryStore,
  args: {
    evidenceItemId: string;
    snapshot: Record<string, unknown>;
    /** Evidence id whose edition this one supersedes (edges get retracted). */
    supersedes?: string;
  },
) {
  if (args.supersedes) retractSupportEdges(store, args.supersedes);
  return await upsertClaimsForEvidence(db, {
    tenantId: TENANT_ID,
    targetScope: "tenant",
    targetId: TENANT_ID,
    sourceConfigId: SOURCE_CONFIG_ID,
    evidenceItemId: args.evidenceItemId,
    subjectKey: SUBJECT_KEY,
    effectiveFrom: new Date(args.snapshot.updatedAt as string),
    claims: extractCompanyClaims({
      snapshot: args.snapshot,
      sourceItemId: "co-1",
      targetScope: "tenant",
      targetId: TENANT_ID,
    }),
  });
}

function claimsFor(store: FakeMemoryStore, predicate: string) {
  return store.claims
    .filter((c) => c.ontology_predicate === predicate)
    .sort(
      (a, b) =>
        (a.created_at as Date).getTime() - (b.created_at as Date).getTime(),
    );
}

function activeClaims(store: FakeMemoryStore) {
  return store.claims.filter((c) => c.status === "active");
}

/** Deep search for a string needle inside a (possibly cyclic) SQL object. */
function containsString(
  value: unknown,
  needle: string,
  seen = new Set<object>(),
): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((v) => containsString(v, needle, seen));
}

describe("upsertClaimsForEvidence claim lifecycle", () => {
  it("same-value reassertion from a newer edition reuses the active row and preserves its effective_from", async () => {
    const { db, store, executeCalls } = makeFakeMemoryDb();
    const snapshot = (updatedAt: string) => ({
      id: "co-1",
      name: "Acme",
      address: { addressCity: "Springfield" },
      updatedAt,
    });

    const first = await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: snapshot(T1),
    });
    expect(first.created).toBe(2);

    const second = await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: snapshot(T2),
      supersedes: "ev-1",
    });

    // No new rows, no supersession — the same fact reasserted.
    expect(second.created).toBe(0);
    expect(second.supersededSupports).toBe(0);
    expect(second.unsupportedRetracted).toBe(0);
    expect(store.claims).toHaveLength(2);
    for (const predicate of ["customer.name", "customer.address"]) {
      const rows = claimsFor(store, predicate);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("active");
      // Original observation time preserved, NOT bumped to T2.
      expect(rows[0]!.effective_from).toEqual(new Date(T1));
      expect(rows[0]!.effective_to).toBeNull();
    }
    // The new edition's support edge landed on the reused claim.
    const activeEdges = store.claimEdges.filter((e) => e.status === "active");
    expect(activeEdges.every((e) => e.evidence_item_id === "ev-2")).toBe(true);
    expect(activeEdges).toHaveLength(2);

    // Each upsert took the per-subject advisory lock exactly once, keyed on
    // the ("memory_claims", tenant, scope, target, subject) tuple.
    const locks = executeCalls();
    expect(locks).toHaveLength(2);
    expect(containsString(locks[0], "memory_claims")).toBe(true);
    expect(containsString(locks[0], SUBJECT_KEY)).toBe(true);
  });

  it("temporal recurrence 77→91→77 keeps three interval rows with exactly one active", async () => {
    const { db, store } = makeFakeMemoryDb();
    const snapshot = (employees: number, updatedAt: string) => ({
      id: "co-1",
      employees,
      updatedAt,
    });

    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: snapshot(77, T1),
    });
    await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: snapshot(91, T2),
      supersedes: "ev-1",
    });
    await applyEdition(db, store, {
      evidenceItemId: "ev-3",
      snapshot: snapshot(77, T3),
      supersedes: "ev-2",
    });

    const rows = claimsFor(store, "customer.employees");
    expect(rows).toHaveLength(3);

    const [first77, only91, second77] = rows as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // First 77: closed when 91 arrived.
    expect(first77.value).toEqual({ count: 77 });
    expect(first77.status).toBe("superseded");
    expect(first77.effective_to).toEqual(new Date(T2));
    // 91: closed when 77 recurred.
    expect(only91.value).toEqual({ count: 91 });
    expect(only91.status).toBe("superseded");
    expect(only91.effective_to).toEqual(new Date(T3));
    // The recurrence is a NEW temporal edition, the only active row.
    expect(second77.value).toEqual({ count: 77 });
    expect(second77.status).toBe("active");
    expect(second77.effective_from).toEqual(new Date(T3));
    expect(second77.effective_to).toBeNull();
    expect(
      rows.filter((r) => (r as { status: string }).status === "active"),
    ).toHaveLength(1);
  });

  it("a value change closes the losing claim's interval at the incoming effective_from", async () => {
    const { db, store } = makeFakeMemoryDb();
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: { id: "co-1", name: "Acme", updatedAt: T1 },
    });
    await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: { id: "co-1", name: "Acme Corp", updatedAt: T2 },
      supersedes: "ev-1",
    });

    const rows = claimsFor(store, "customer.name");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      status: "superseded",
      effective_to: new Date(T2),
    });
    expect(rows[1]).toMatchObject({ status: "active", effective_to: null });
  });

  it("multi-valued facts removed from the source are retracted by the zero-support sweep and drop out of the projection", async () => {
    const { db, store } = makeFakeMemoryDb();
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: {
        id: "co-1",
        name: "Acme",
        people: [{ id: "p-1", name: "Ada Lovelace" }],
        notes: [{ id: "n-1", title: "Kickoff" }],
        updatedAt: T1,
      },
    });
    // Edition 2 removes the person and the note entirely.
    const result = await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: { id: "co-1", name: "Acme", updatedAt: T2 },
      supersedes: "ev-1",
    });

    expect(result.unsupportedRetracted).toBe(2);
    expect(claimsFor(store, "customer.person")[0]!.status).toBe("retracted");
    expect(claimsFor(store, "customer.note")[0]!.status).toBe("retracted");
    expect(claimsFor(store, "customer.name")[0]!.status).toBe("active");

    const { markdown } = buildClaimProjection(
      activeClaims(store).map((c) => ({
        id: c.id as string,
        ontologyPredicate: c.ontology_predicate as string,
        value: c.value as Record<string, unknown>,
        effectiveFrom: c.effective_from as Date | null,
      })),
      { title: "Acme", subjectKey: SUBJECT_KEY },
    );
    expect(markdown).not.toContain("Ada Lovelace");
    expect(markdown).not.toContain("Kickoff");
    expect(markdown).not.toContain("## People");
    expect(markdown).not.toContain("## Notes");
    expect(markdown).toContain("Name: Acme");
  });

  it("a claim corroborated by an ACTIVE edge from a different evidence item survives the sweep", async () => {
    const { db, store } = makeFakeMemoryDb();
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: {
        id: "co-1",
        name: "Acme",
        people: [{ id: "p-1", name: "Ada Lovelace" }],
        notes: [{ id: "n-1", title: "Kickoff" }],
        updatedAt: T1,
      },
    });
    // Independent corroboration: a DIFFERENT evidence item (e.g. another
    // source record) also supports the person claim.
    const person = claimsFor(store, "customer.person")[0]!;
    store.claimEdges.push({
      id: 9001,
      tenant_id: TENANT_ID,
      claim_id: person.id,
      evidence_item_id: "ev-other",
      source_config_id: SOURCE_CONFIG_ID,
      status: "active",
      created_at: new Date(T1),
      retracted_at: null,
    });

    const result = await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: { id: "co-1", name: "Acme", updatedAt: T2 },
      supersedes: "ev-1",
    });

    // Only the note (supported solely by ev-1) is swept.
    expect(result.unsupportedRetracted).toBe(1);
    expect(claimsFor(store, "customer.person")[0]!.status).toBe("active");
    expect(claimsFor(store, "customer.note")[0]!.status).toBe("retracted");
  });

  it("reprocessing an older edition attaches provenance to the superseded row WITHOUT reactivating it or displacing the current value", async () => {
    const { db, store } = makeFakeMemoryDb();
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: { id: "co-1", employees: 77, updatedAt: T1 },
    });
    await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: { id: "co-1", employees: 91, updatedAt: T2 },
      supersedes: "ev-1",
    });

    // Older-edition reprocessing (e.g. a redrive replays the T1 snapshot
    // under a fresh evidence row). Its claim's exact fingerprint — value AND
    // effective_from T1 — matches the SUPERSEDED historical row.
    const result = await applyEdition(db, store, {
      evidenceItemId: "ev-old-replay",
      snapshot: { id: "co-1", employees: 77, updatedAt: T1 },
    });

    const rows = claimsFor(store, "customer.employees");
    expect(rows).toHaveLength(2); // no new claim minted
    expect(result.created).toBe(0);
    const [old77, current91] = rows as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    // INTENDED behavior: the historical row is reused idempotently for
    // provenance only — its status must stay 'superseded' (no resurrection)
    // and the current active claim must NOT be superseded by the replay.
    expect(old77.status).toBe("superseded");
    expect(old77.effective_to).toEqual(new Date(T2));
    expect(current91.status).toBe("active");
    expect(result.supersededSupports).toBe(0);
    // …but the support edge IS attached to the historical claim, without
    // flipping its status.
    const replayEdge = store.claimEdges.find(
      (e) => e.evidence_item_id === "ev-old-replay",
    );
    expect(replayEdge).toMatchObject({ claim_id: old77.id, status: "active" });
  });

  it("projection over the single-active-claim state emits each Overview line exactly once", async () => {
    const { db, store } = makeFakeMemoryDb();
    const snapshot = (updatedAt: string) => ({
      id: "co-1",
      name: "Acme",
      employees: 77,
      address: { addressCity: "Springfield" },
      updatedAt,
    });
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: snapshot(T1),
    });
    // Scenario-1 shape: identical values reasserted from a newer edition.
    await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: snapshot(T2),
      supersedes: "ev-1",
    });

    const { markdown } = buildClaimProjection(
      activeClaims(store).map((c) => ({
        id: c.id as string,
        ontologyPredicate: c.ontology_predicate as string,
        value: c.value as Record<string, unknown>,
        effectiveFrom: c.effective_from as Date | null,
      })),
      { title: "Acme", subjectKey: SUBJECT_KEY },
    );

    const bulletLines = markdown
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(bulletLines).toHaveLength(3);
    // No duplicate markdown lines.
    expect(new Set(bulletLines).size).toBe(bulletLines.length);
    expect(bulletLines.filter((l) => l.includes("Name:"))).toHaveLength(1);
    expect(bulletLines.filter((l) => l.includes("Employees:"))).toHaveLength(1);
    expect(bulletLines.filter((l) => l.includes("Address:"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Round-4 P1-A: superseded-edition edge retirement moved INTO the project
// transaction — acquire leaves old supports active; project heals.
// ---------------------------------------------------------------------------

describe("upsertClaimsForEvidence superseded-edition edge retirement (P1-A)", () => {
  const snapshotV1 = {
    id: "co-1",
    name: "Acme",
    employees: 77,
    updatedAt: T1,
  };
  const snapshotV2 = {
    id: "co-1",
    name: "Acme",
    employees: 91,
    updatedAt: T2,
  };

  function seedEvidence(store: FakeMemoryStore) {
    store.evidenceItems.push(
      {
        id: "ev-1",
        tenant_id: TENANT_ID,
        source_config_id: SOURCE_CONFIG_ID,
        source_item_id: "co-1",
        source_version: "v1",
        lifecycle: "active",
      },
      {
        id: "ev-2",
        tenant_id: TENANT_ID,
        source_config_id: SOURCE_CONFIG_ID,
        source_item_id: "co-1",
        source_version: "v2",
        lifecycle: "active",
      },
    );
  }

  it("a project crash between acquire and project leaves the OLD supports (and claims) fully active", async () => {
    const { db, store } = makeFakeMemoryDb();
    seedEvidence(store);
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: snapshotV1,
    });
    // Acquire of edition 2: the evidence is superseded but NO edge is
    // retracted (recordAcquiredPage no longer touches edges) — and edition
    // 2's project never runs (crash).
    store.evidenceItems.find((r) => r.id === "ev-1")!.lifecycle = "superseded";

    for (const claim of activeClaims(store)) {
      const activeEdges = store.claimEdges.filter(
        (e) => e.claim_id === claim.id && e.status === "active",
      );
      expect(activeEdges.length).toBeGreaterThan(0);
      expect(activeEdges.every((e) => e.evidence_item_id === "ev-1")).toBe(
        true,
      );
    }
  });

  it("the next successful project retires the superseded edition's edges atomically and heals the graph", async () => {
    const { db, store } = makeFakeMemoryDb();
    seedEvidence(store);
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: snapshotV1,
    });
    store.evidenceItems.find((r) => r.id === "ev-1")!.lifecycle = "superseded";

    // Edition 2 projects WITHOUT any acquire-time retraction helper: the
    // upsert transaction itself retires ev-1's edges.
    await applyEdition(db, store, {
      evidenceItemId: "ev-2",
      snapshot: snapshotV2,
    });

    const ev1Edges = store.claimEdges.filter(
      (e) => e.evidence_item_id === "ev-1",
    );
    expect(ev1Edges.length).toBeGreaterThan(0);
    expect(ev1Edges.every((e) => e.status === "retracted")).toBe(true);
    // Every active claim is supported by the NEW edition only.
    for (const claim of activeClaims(store)) {
      const activeEdges = store.claimEdges.filter(
        (e) => e.claim_id === claim.id && e.status === "active",
      );
      expect(activeEdges.length).toBeGreaterThan(0);
      expect(activeEdges.every((e) => e.evidence_item_id === "ev-2")).toBe(
        true,
      );
    }
    // And the employees value transitioned 77 → 91 with a closed interval.
    const employees = claimsFor(store, "customer.employees");
    const old = employees.find(
      (c) => (c.value as { count: number }).count === 77,
    )!;
    expect(old.status).toBe("superseded");
    expect(old.effective_to).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Round-4 P2-D: interval closure on retraction, incl. null provider timestamp
// ---------------------------------------------------------------------------

describe("interval closure on retraction (P2-D)", () => {
  it("multi-valued claims swept with a NULL edition timestamp close effective_to at the durable transition time", async () => {
    const { db, store } = makeFakeMemoryDb();
    store.evidenceItems.push(
      {
        id: "ev-1",
        tenant_id: TENANT_ID,
        source_config_id: SOURCE_CONFIG_ID,
        source_item_id: "co-1",
        source_version: "v1",
        lifecycle: "active",
      },
      {
        id: "ev-2",
        tenant_id: TENANT_ID,
        source_config_id: SOURCE_CONFIG_ID,
        source_item_id: "co-1",
        source_version: "v2",
        lifecycle: "active",
      },
    );
    // Edition 1 (ev-1) asserts a person; edition 2 (ev-2) removes it.
    const withPerson = {
      id: "co-1",
      name: "Acme",
      people: [{ id: "p-1", name: "Pat" }],
      updatedAt: T1,
    };
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: withPerson,
    });
    // Acquire supersedes ev-1; the new edition extracts no person and has
    // NO provider timestamp at all.
    store.evidenceItems.find((r) => r.id === "ev-1")!.lifecycle = "superseded";
    await upsertClaimsForEvidence(db, {
      tenantId: TENANT_ID,
      targetScope: "tenant",
      targetId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      evidenceItemId: "ev-2",
      subjectKey: SUBJECT_KEY,
      effectiveFrom: null,
      claims: extractCompanyClaims({
        snapshot: { id: "co-1", name: "Acme" },
        sourceItemId: "co-1",
        targetScope: "tenant",
        targetId: TENANT_ID,
      }),
    });

    const person = claimsFor(store, "customer.person")[0]!;
    expect(person.status).toBe("retracted");
    expect(person.effective_to).toBeInstanceOf(Date);
  });

  it("deactivateOrphanedClaims closes effective_to at the durable transition time", async () => {
    const { db, store } = makeFakeMemoryDb();
    await applyEdition(db, store, {
      evidenceItemId: "ev-1",
      snapshot: { id: "co-1", name: "Acme", updatedAt: T1 },
    });
    // All of ev-1's support disappears (erase finalize path).
    retractSupportEdges(store, "ev-1");
    const { deactivateOrphanedClaims } = await import("./claims.js");
    const count = await deactivateOrphanedClaims(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      evidenceItemId: "ev-1",
    });
    expect(count).toBeGreaterThan(0);
    for (const claim of store.claims.filter((c) => c.status === "retracted")) {
      expect(claim.effective_to).toBeInstanceOf(Date);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-3 P1-2: erase write-fence inside the claim transaction
// ---------------------------------------------------------------------------

describe("upsertClaimsForEvidence erase fence", () => {
  function seedSource(store: FakeMemoryStore, eraseGeneration: number) {
    store.sourceConfigs.push({
      id: SOURCE_CONFIG_ID,
      tenant_id: TENANT_ID,
      enabled: true,
      erase_generation: eraseGeneration,
    });
  }

  it("aborts the transaction (no claims, no edges) when the erase generation advanced", async () => {
    const { db, store } = makeFakeMemoryDb();
    seedSource(store, 1); // erase already began: generation moved 0 → 1
    await expect(
      upsertClaimsForEvidence(db, {
        tenantId: TENANT_ID,
        targetScope: "tenant",
        targetId: TENANT_ID,
        sourceConfigId: SOURCE_CONFIG_ID,
        evidenceItemId: "ev-1",
        subjectKey: SUBJECT_KEY,
        effectiveFrom: new Date(T1),
        eraseFence: { expectedEraseGeneration: 0 },
        claims: extractCompanyClaims({
          snapshot: { id: "co-1", name: "Acme", updatedAt: T1 },
          sourceItemId: "co-1",
          targetScope: "tenant",
          targetId: TENANT_ID,
        }),
      }),
    ).rejects.toThrow(/erase generation advanced/);
    expect(store.claims).toHaveLength(0);
    expect(store.claimEdges).toHaveLength(0);
  });

  it("writes normally when the fence matches", async () => {
    const { db, store } = makeFakeMemoryDb();
    seedSource(store, 3);
    const result = await upsertClaimsForEvidence(db, {
      tenantId: TENANT_ID,
      targetScope: "tenant",
      targetId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      evidenceItemId: "ev-1",
      subjectKey: SUBJECT_KEY,
      effectiveFrom: new Date(T1),
      eraseFence: { expectedEraseGeneration: 3 },
      claims: extractCompanyClaims({
        snapshot: { id: "co-1", name: "Acme", updatedAt: T1 },
        sourceItemId: "co-1",
        targetScope: "tenant",
        targetId: TENANT_ID,
      }),
    });
    expect(result.created).toBeGreaterThan(0);
    expect(store.claims.length).toBeGreaterThan(0);
  });
});
