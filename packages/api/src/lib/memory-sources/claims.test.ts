import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildClaimProjection,
  extractCompanyClaims,
  SINGLE_VALUED_PREDICATES,
} from "./claims.js";

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
