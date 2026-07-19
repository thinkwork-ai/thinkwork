import { describe, expect, it } from "vitest";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import {
  decideMatch,
  defaultIdentityRules,
  matchCanonicalEntity,
} from "./matcher.js";
import { hashIdentityValue, type IdentityRule } from "./normalizers.js";

const strongDomainRule: IdentityRule = {
  slug: "company-domain",
  keyKind: "domain",
  normalization: "domain",
  unique: true,
  uniquenessScope: "tenant",
  sourcePrecedence: [],
  autoLink: true,
  version: 1,
};

const weakNameRule: IdentityRule = {
  slug: "company-name",
  keyKind: "name",
  normalization: "name",
  unique: false,
  uniquenessScope: "tenant",
  sourcePrecedence: [],
  autoLink: false,
  version: 1,
};

describe("decideMatch", () => {
  it("exact source mapping wins over everything", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: "canon-exact",
      claimMatches: [
        {
          keyKind: "domain",
          canonicalEntityId: "other",
          canonicalDisplayName: null,
        },
      ],
      nameCandidates: [],
    });
    expect(verdict).toEqual({
      kind: "exact",
      canonicalEntityId: "canon-exact",
    });
  });

  it("private evidence without an exact mapping is private_unmapped (never creates)", () => {
    const verdict = decideMatch({
      visibility: "private",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "domain",
          canonicalEntityId: "c1",
          canonicalDisplayName: null,
        },
      ],
      nameCandidates: [{ canonicalEntityId: "c1", displayName: "Acme" }],
    });
    expect(verdict).toEqual({ kind: "private_unmapped" });
  });

  it("private evidence MAY reuse an exact mapping", () => {
    const verdict = decideMatch({
      visibility: "private",
      rules: [],
      exactCanonicalEntityId: "canon-exact",
      claimMatches: [],
      nameCandidates: [],
    });
    expect(verdict).toEqual({
      kind: "exact",
      canonicalEntityId: "canon-exact",
    });
  });

  it("auto-links on a single non-conflicting strong-key match", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "domain",
          canonicalEntityId: "c1",
          canonicalDisplayName: "Acme",
        },
      ],
      nameCandidates: [],
    });
    expect(verdict).toEqual({
      kind: "auto_link",
      canonicalEntityId: "c1",
      ruleSlug: "company-domain",
    });
  });

  it("does NOT auto-link on a strong key whose rule is not unique+autoLink", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [weakNameRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "name",
          canonicalEntityId: "c1",
          canonicalDisplayName: "Acme",
        },
      ],
      nameCandidates: [],
    });
    expect(verdict.kind).toBe("suggestion");
  });

  it("conflicting strong keys (two distinct canonicals) are ambiguous", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "domain",
          canonicalEntityId: "c1",
          canonicalDisplayName: "A",
        },
        {
          keyKind: "domain",
          canonicalEntityId: "c2",
          canonicalDisplayName: "B",
        },
      ],
      nameCandidates: [],
    });
    expect(verdict.kind).toBe("ambiguous");
    if (verdict.kind === "ambiguous") {
      expect(verdict.candidates.map((c) => c.canonicalEntityId).sort()).toEqual(
        ["c1", "c2"],
      );
    }
  });

  it("single weak match is a suggestion, multiple weak matches are ambiguous", () => {
    const single = decideMatch({
      visibility: "tenant",
      rules: [weakNameRule],
      exactCanonicalEntityId: null,
      claimMatches: [],
      nameCandidates: [{ canonicalEntityId: "c1", displayName: "Acme" }],
    });
    expect(single).toEqual({
      kind: "suggestion",
      canonicalEntityId: "c1",
      matchedKeyKinds: ["name"],
    });

    const multi = decideMatch({
      visibility: "tenant",
      rules: [weakNameRule],
      exactCanonicalEntityId: null,
      claimMatches: [],
      nameCandidates: [
        { canonicalEntityId: "c1", displayName: "Acme" },
        { canonicalEntityId: "c2", displayName: "Acme (EU)" },
      ],
    });
    expect(multi.kind).toBe("ambiguous");
  });

  it("no candidates at all → new", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [],
      nameCandidates: [],
    });
    expect(verdict).toEqual({ kind: "new" });
  });

  it("default identity rules treat exact-name equality as a strong auto-link key", () => {
    const rules = defaultIdentityRules();
    const verdict = decideMatch({
      visibility: "tenant",
      rules,
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "name",
          canonicalEntityId: "c1",
          canonicalDisplayName: "Acme",
        },
      ],
      nameCandidates: [],
    });
    expect(verdict).toEqual({
      kind: "auto_link",
      canonicalEntityId: "c1",
      ruleSlug: "default-name",
    });
  });
});

describe("decideMatch — negative evidence (KTD-6)", () => {
  it("demotes a rejected strong-key pairing from auto-link to suggestion", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "domain",
          canonicalEntityId: "c1",
          canonicalDisplayName: "Acme",
        },
      ],
      nameCandidates: [],
      rejectedCanonicalEntityIds: new Set(["c1"]),
    });
    // Never auto-links, but the suggestion verdict still feeds the case
    // path — a rejected pairing can surface as a case, never a link.
    expect(verdict).toEqual({
      kind: "suggestion",
      canonicalEntityId: "c1",
      matchedKeyKinds: ["domain"],
    });
  });

  it("still auto-links a clean strong target when a different one is rejected", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "domain",
          canonicalEntityId: "c-rejected",
          canonicalDisplayName: "A",
        },
        {
          keyKind: "domain",
          canonicalEntityId: "c-clean",
          canonicalDisplayName: "B",
        },
      ],
      nameCandidates: [],
      rejectedCanonicalEntityIds: new Set(["c-rejected"]),
    });
    // The rejection only concerns its pairing; the clean target would have
    // been ambiguous without it, but rejected targets leave the strong set.
    expect(verdict).toEqual({
      kind: "auto_link",
      canonicalEntityId: "c-clean",
      ruleSlug: "company-domain",
    });
  });

  it("exact source mapping still wins — an existing mapping row is authoritative", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: "c1",
      claimMatches: [],
      nameCandidates: [],
      rejectedCanonicalEntityIds: new Set(["c1"]),
    });
    expect(verdict).toEqual({ kind: "exact", canonicalEntityId: "c1" });
  });
});

describe("matchCanonicalEntity — rejections load in the DB wrapper", () => {
  const request = {
    tenantId: "tenant-1",
    entityTypeSlug: "company",
    displayName: "Acme",
    visibility: "tenant" as const,
    sourceKeys: [{ sourceSystem: "twenty", externalId: "tw-1" }],
    naturalKeys: [{ keyKind: "domain", rawValue: "acme.com" }],
  };
  const claimRow = {
    key_kind: "domain",
    value_hash: hashIdentityValue("acme.com"),
    canonical_entity_id: "c1",
    display_name: "Acme",
    canonical_status: "active",
    merged_into_id: null,
  };

  it("a rejected (source identity ↔ canonical) pairing never auto-links", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [], // exact mapping lookup — none (the mapping was revoked)
      [{ canonical_entity_id: "c1" }], // mapping_rejections for the source key
      [claimRow], // identity-claim matches
      [], // registry name candidates
    );
    const verdict = await matchCanonicalEntity(fake.db as never, request, [
      strongDomainRule,
    ]);
    expect(verdict).toEqual({
      kind: "suggestion",
      canonicalEntityId: "c1",
      matchedKeyKinds: ["domain"],
    });
  });

  it("the same match auto-links when no rejection row exists", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [], // exact mapping lookup
      [], // no rejections
      [claimRow],
      [],
    );
    const verdict = await matchCanonicalEntity(fake.db as never, request, [
      strongDomainRule,
    ]);
    expect(verdict).toEqual({
      kind: "auto_link",
      canonicalEntityId: "c1",
      ruleSlug: "company-domain",
    });
  });
});
