import { describe, expect, it } from "vitest";
import { decideMatch, defaultIdentityRules } from "./matcher.js";
import type { IdentityRule } from "./normalizers.js";

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
        { keyKind: "domain", canonicalEntityId: "other", canonicalDisplayName: null },
      ],
      nameCandidates: [],
    });
    expect(verdict).toEqual({ kind: "exact", canonicalEntityId: "canon-exact" });
  });

  it("private evidence without an exact mapping is private_unmapped (never creates)", () => {
    const verdict = decideMatch({
      visibility: "private",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        { keyKind: "domain", canonicalEntityId: "c1", canonicalDisplayName: null },
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
    expect(verdict).toEqual({ kind: "exact", canonicalEntityId: "canon-exact" });
  });

  it("auto-links on a single non-conflicting strong-key match", () => {
    const verdict = decideMatch({
      visibility: "tenant",
      rules: [strongDomainRule],
      exactCanonicalEntityId: null,
      claimMatches: [
        { keyKind: "domain", canonicalEntityId: "c1", canonicalDisplayName: "Acme" },
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
        { keyKind: "name", canonicalEntityId: "c1", canonicalDisplayName: "Acme" },
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
        { keyKind: "domain", canonicalEntityId: "c1", canonicalDisplayName: "A" },
        { keyKind: "domain", canonicalEntityId: "c2", canonicalDisplayName: "B" },
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
        { keyKind: "name", canonicalEntityId: "c1", canonicalDisplayName: "Acme" },
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
