import { describe, expect, it } from "vitest";
import {
  applyNormalization,
  computeIdentitySignature,
  hashIdentityValue,
  normalizeDomain,
  normalizeEmail,
  normalizeEntityName,
  parseIdentityRules,
} from "./normalizers.js";

describe("normalizeEntityName", () => {
  it("folds case, punctuation, and whitespace variants together", () => {
    expect(normalizeEntityName("Acme, Inc.")).toBe("acme inc");
    expect(normalizeEntityName("ACME   Inc")).toBe("acme inc");
    expect(normalizeEntityName("  acme inc  ")).toBe("acme inc");
  });

  it("does NOT strip meaning-bearing suffix tokens (no over-merge)", () => {
    expect(normalizeEntityName("Acme")).not.toBe(normalizeEntityName("Acme Inc"));
    expect(normalizeEntityName("Acme")).not.toBe(
      normalizeEntityName("Acme Labs"),
    );
  });

  it("applies NFKC so width/compatibility variants fold", () => {
    expect(normalizeEntityName("Ａｃｍｅ")).toBe("acme");
  });

  it("preserves unicode letters", () => {
    expect(normalizeEntityName("Café Müller")).toBe("café müller");
  });
});

describe("normalizeDomain", () => {
  it("strips scheme, path, port, userinfo, and www", () => {
    expect(normalizeDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(normalizeDomain("acme.com:8443")).toBe("acme.com");
    expect(normalizeDomain("user@mail.acme.com")).toBe("mail.acme.com");
    expect(normalizeDomain("acme.com.")).toBe("acme.com");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims without plus-tag stripping", () => {
    expect(normalizeEmail("  Bob+CRM@Acme.COM ")).toBe("bob+crm@acme.com");
  });
});

describe("applyNormalization", () => {
  it("routes by kind and trims exact values", () => {
    expect(applyNormalization("name", "Acme, Inc.")).toBe("acme inc");
    expect(applyNormalization("domain", "https://acme.com/")).toBe("acme.com");
    expect(applyNormalization("email", "A@B.c")).toBe("a@b.c");
    expect(applyNormalization("exact", " x-1 ")).toBe("x-1");
  });
});

describe("hashIdentityValue", () => {
  it("produces stable fixed-length sha256 hex", () => {
    const hash = hashIdentityValue("acme inc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIdentityValue("acme inc")).toBe(hash);
    expect(hashIdentityValue("acme labs")).not.toBe(hash);
  });
});

describe("computeIdentitySignature", () => {
  it("is order-independent over keys (case coalescing invariant)", () => {
    const a = computeIdentitySignature({
      entityTypeSlug: "company",
      keys: [
        { keyKind: "name", normalizedValue: "acme" },
        { keyKind: "domain", normalizedValue: "acme.com" },
      ],
    });
    const b = computeIdentitySignature({
      entityTypeSlug: "company",
      keys: [
        { keyKind: "domain", normalizedValue: "acme.com" },
        { keyKind: "name", normalizedValue: "acme" },
      ],
    });
    expect(a).toBe(b);
  });

  it("differs across entity types and key values", () => {
    const base = computeIdentitySignature({
      entityTypeSlug: "company",
      keys: [{ keyKind: "name", normalizedValue: "acme" }],
    });
    expect(
      computeIdentitySignature({
        entityTypeSlug: "person",
        keys: [{ keyKind: "name", normalizedValue: "acme" }],
      }),
    ).not.toBe(base);
    expect(
      computeIdentitySignature({
        entityTypeSlug: "company",
        keys: [{ keyKind: "name", normalizedValue: "acme labs" }],
      }),
    ).not.toBe(base);
  });
});

describe("parseIdentityRules", () => {
  it("parses well-formed rules and defaults optional fields", () => {
    const rules = parseIdentityRules([
      {
        slug: "company-domain",
        keyKind: "domain",
        normalization: "domain",
        unique: true,
        uniquenessScope: "tenant",
        sourcePrecedence: ["twenty", "gmail"],
        autoLink: true,
        version: 3,
      },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(
      expect.objectContaining({
        slug: "company-domain",
        unique: true,
        autoLink: true,
        version: 3,
        sourcePrecedence: ["twenty", "gmail"],
      }),
    );
  });

  it("drops malformed entries instead of throwing (operator-edit safety)", () => {
    expect(parseIdentityRules(null)).toEqual([]);
    expect(parseIdentityRules("junk")).toEqual([]);
    expect(
      parseIdentityRules([
        { slug: "x" }, // missing keyKind/normalization
        { slug: "ok", keyKind: "name", normalization: "name" },
        42,
      ]),
    ).toHaveLength(1);
  });

  it("treats unique/autoLink as false unless explicitly true", () => {
    const [rule] = parseIdentityRules([
      { slug: "r", keyKind: "name", normalization: "name", unique: "yes" },
    ]);
    expect(rule!.unique).toBe(false);
    expect(rule!.autoLink).toBe(false);
  });
});
