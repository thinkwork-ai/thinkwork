import { describe, expect, it } from "vitest";

import {
  assertBoundaryWithin,
  assertGrantBoundaryValid,
  assertSourceConfigBoundaryValid,
  BOUNDARY_SCHEMAS,
  grantInactiveReason,
  isUrlWithinUrlSet,
  MemoryAuthorizationError,
  normalizeExactUrl,
  parseUrlSetEntry,
  resolveExactUrls,
} from "./policy.js";
import { TWENTY_GOVERNED_OBJECTS } from "./adapters/twenty.js";

describe("MemoryAuthorizationError", () => {
  it("has a stable name for callers that switch on it", () => {
    const err = new MemoryAuthorizationError("nope");
    expect(err.name).toBe("MemoryAuthorizationError");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("nope");
  });
});

// sourceFamily is a REQUIRED argument; fixtures evaluate under the
// registered 'twenty' schema unless a test overrides the family.
function within(
  grant: Record<string, unknown>,
  config: Record<string, unknown>,
  sourceFamily = "twenty",
) {
  return () => assertBoundaryWithin(grant, config, { sourceFamily });
}

describe("assertBoundaryWithin", () => {
  it("passes when the config boundary is a subset of the grant envelope", () => {
    expect(
      within(
        {
          maxRecords: 100,
          pageSize: 50,
          objects: ["companies", "relations"],
        },
        { maxRecords: 100, pageSize: 10, objects: ["companies"] },
      ),
    ).not.toThrow();
  });

  it("rejects a numeric cap above the grant's, naming the key", () => {
    expect(within({ maxRecords: 100 }, { maxRecords: 101 })).toThrow(
      /maxRecords/,
    );
    expect(within({ maxRecords: 100 }, { maxRecords: 101 })).toThrow(
      MemoryAuthorizationError,
    );
  });

  it("rejects an array value outside the grant allowlist, naming the key", () => {
    expect(
      within(
        { objects: ["companies"] },
        { objects: ["companies", "opportunities"] },
      ),
    ).toThrow(/objects/);
    expect(within({ objects: ["companies"] }, { objects: ["people"] })).toThrow(
      MemoryAuthorizationError,
    );
  });

  it("rejects a non-numeric config value against a numeric dimension", () => {
    expect(within({ pageSize: 50 }, { pageSize: "all" })).toThrow(/pageSize/);
    expect(within({}, { maxRecords: true })).toThrow(/maxRecords/);
    expect(within({}, { maxRecords: Number.NaN })).toThrow(/maxRecords/);
  });

  it("rejects a non-array config value against an allowlist dimension", () => {
    expect(
      within({ objects: ["companies"] }, { objects: "companies" }),
    ).toThrow(/objects/);
  });

  it("fails closed on an empty grant: config is held to the schema defaults", () => {
    // Defaults (twenty): maxRecords 200, pageSize 50 — at/below passes …
    expect(within({}, { maxRecords: 200, pageSize: 50 })).not.toThrow();
    // … above throws. An empty grant is NOT an unlimited grant.
    expect(within({}, { maxRecords: 10_000 })).toThrow(/maxRecords/);
    expect(within({}, { pageSize: 51 })).toThrow(/pageSize/);
    expect(within({}, { objects: ["relations"] })).toThrow(/objects/);
    expect(within({}, { objects: ["companies"] })).not.toThrow();
  });

  it("applies the default per dimension when the grant only sets others", () => {
    expect(
      within({ pageSize: 100 }, { pageSize: 100, maxRecords: 500 }),
    ).toThrow(/maxRecords/);
  });

  it("compares EFFECTIVE values: a config omitting a dimension still requests the runtime default", () => {
    // stages.ts falls back to DEFAULT_MAX_RECORDS (200) when the config omits
    // maxRecords, so a grant capping it at 50 must reject the omission.
    expect(within({ maxRecords: 50 }, {})).toThrow(/maxRecords/);
    // A grant at/above the runtime default accepts the omission.
    expect(within({ maxRecords: 200 }, {})).not.toThrow();
  });

  it("a grant may widen a dimension beyond its default, up to the dimension max", () => {
    expect(within({ maxRecords: 2000 }, { maxRecords: 2000 })).not.toThrow();
    expect(
      within(
        { objects: ["companies", "relations"] },
        { objects: ["relations"] },
      ),
    ).not.toThrow();
  });

  it("rejects unknown dimensions in the requested boundary, naming the key", () => {
    expect(within({}, { domains: ["anything"] })).toThrow(/domains/);
    // Unknown even when the grant echoes the same key — ungoverned keys
    // grant nothing.
    expect(
      within({ webhookUrl: "https://x" }, { webhookUrl: "https://x" }),
    ).toThrow(/webhookUrl/);
    expect(within({ maxRecords: 5 }, { maxRecords: 5, extra: true })).toThrow(
      /extra/,
    );
  });

  it("rejects a grant value that is not comparable for its dimension", () => {
    expect(within({ maxRecords: "lots" }, { maxRecords: 10 })).toThrow(
      /maxRecords/,
    );
    expect(
      within({ objects: "companies" }, { objects: ["companies"] }),
    ).toThrow(/objects/);
  });

  it("rejects unknown keys in the GRANT boundary (a typo must not fall back to defaults)", () => {
    // 'maxRecord' (typo) silently granting the default 200 envelope was the
    // Codex P2 finding — the grant must be rejected, not reinterpreted.
    expect(within({ maxRecord: 100 }, {})).toThrow(/maxRecord/);
    expect(within({ note: "operator comment" }, { maxRecords: 10 })).toThrow(
      /note/,
    );
  });

  it("rejects zero/negative/fractional numeric values on BOTH sides", () => {
    // Runtime clamps floor values UPWARD (effectiveLimit min 1,
    // snapshotTtlDays min 7), so out-of-domain values must never pass
    // comparison as if they were narrower.
    expect(within({}, { maxRecords: 0 })).toThrow(/maxRecords/);
    expect(within({}, { pageSize: -1 })).toThrow(/pageSize/);
    expect(within({}, { maxRecords: 2.5 })).toThrow(/maxRecords/);
    expect(within({}, { snapshotTtlDays: 3 })).toThrow(/snapshotTtlDays/);
    expect(within({ maxRecords: 0 }, {})).toThrow(/maxRecords/);
    expect(within({ pageSize: 0.5 }, {})).toThrow(/pageSize/);
    expect(within({ snapshotTtlDays: 3 }, {})).toThrow(/snapshotTtlDays/);
    // Above the per-dimension max is equally invalid on either side.
    expect(within({ maxRecords: 5000 }, {})).toThrow(/maxRecords/);
    expect(within({}, { pageSize: 201 })).toThrow(/pageSize/);
  });

  it("rejects objects values outside the governed Twenty domain on BOTH sides", () => {
    expect(
      within({ objects: ["webhooks"] }, { objects: ["webhooks"] }),
    ).toThrow(/webhooks/);
    expect(within({}, { objects: ["companies", "tasks"] })).toThrow(/tasks/);
    expect(within({}, { objects: [42] })).toThrow(/objects/);
    expect(
      within(
        { objects: ["companies", "relations"] },
        { objects: ["companies", "relations"] },
      ),
    ).not.toThrow();
  });

  it("rejects per-relation subsets: the wire is depth 0/1, so finer granularity cannot be honored", () => {
    // 'people'/'opportunities'/'notes' are NOT governed values — a mixed
    // subset like companies+people would still read every relation body
    // over the wire at depth 1, so it must fail closed on BOTH sides.
    expect(
      within(
        { objects: ["companies", "people"] },
        { objects: ["companies", "people"] },
      ),
    ).toThrow(/people/);
    expect(within({}, { objects: ["companies", "notes"] })).toThrow(/notes/);
    expect(within({ objects: ["opportunities"] }, {})).toThrow(/opportunities/);
  });

  it("fails closed for a source family with no registered schema", () => {
    expect(within({}, {}, "salesforce")).toThrow(MemoryAuthorizationError);
    expect(within({}, {}, "salesforce")).toThrow(/salesforce/);
    // Untyped callers that drop the required family option fail closed
    // too — there is no default family.
    expect(() =>
      assertBoundaryWithin(
        {},
        {},
        undefined as unknown as { sourceFamily: string },
      ),
    ).toThrow(MemoryAuthorizationError);
  });

  it("governs the batch and snapshot dimensions read by stages", () => {
    expect(
      within({}, { projectBatch: 25, retainBatch: 25, snapshotTtlDays: 30 }),
    ).not.toThrow();
    expect(within({}, { projectBatch: 26 })).toThrow(/projectBatch/);
    expect(within({}, { retainBatch: 26 })).toThrow(/retainBatch/);
    expect(within({}, { snapshotTtlDays: 31 })).toThrow(/snapshotTtlDays/);
  });
});

describe("assertGrantBoundaryValid (grant-time validation)", () => {
  it("accepts a well-formed grant boundary", () => {
    expect(() =>
      assertGrantBoundaryValid(
        {
          maxRecords: 500,
          pageSize: 100,
          objects: ["companies", "relations"],
        },
        { sourceFamily: "twenty" },
      ),
    ).not.toThrow();
    expect(() =>
      assertGrantBoundaryValid({}, { sourceFamily: "twenty" }),
    ).not.toThrow();
  });

  it("rejects unknown keys so operators see typos immediately", () => {
    expect(() =>
      assertGrantBoundaryValid({ maxRecord: 100 }, { sourceFamily: "twenty" }),
    ).toThrow(/maxRecord/);
    expect(() =>
      assertGrantBoundaryValid({ maxRecord: 100 }, { sourceFamily: "twenty" }),
    ).toThrow(MemoryAuthorizationError);
  });

  it("rejects out-of-domain numeric values", () => {
    expect(() =>
      assertGrantBoundaryValid({ maxRecords: 0 }, { sourceFamily: "twenty" }),
    ).toThrow(/maxRecords/);
    expect(() =>
      assertGrantBoundaryValid({ pageSize: 2.5 }, { sourceFamily: "twenty" }),
    ).toThrow(/pageSize/);
    expect(() =>
      assertGrantBoundaryValid(
        { snapshotTtlDays: 365 },
        { sourceFamily: "twenty" },
      ),
    ).toThrow(/snapshotTtlDays/);
  });

  it("rejects objects entries outside the governed domain", () => {
    expect(() =>
      assertGrantBoundaryValid(
        { objects: ["companies", "webhooks"] },
        { sourceFamily: "twenty" },
      ),
    ).toThrow(/webhooks/);
    // Per-relation subsets are ungovernable (binary wire capability).
    expect(() =>
      assertGrantBoundaryValid(
        { objects: ["companies", "people"] },
        { sourceFamily: "twenty" },
      ),
    ).toThrow(/people/);
    expect(() =>
      assertGrantBoundaryValid(
        { objects: "companies" },
        { sourceFamily: "twenty" },
      ),
    ).toThrow(/objects/);
  });

  it("fails closed for an unregistered source family", () => {
    // firecrawl gained a schema in U5; email stays unregistered until U6.
    expect(() =>
      assertGrantBoundaryValid({}, { sourceFamily: "email" }),
    ).toThrow(MemoryAuthorizationError);
  });
});

describe("boundary schema <-> adapter capability drift", () => {
  it("the twenty objects domain matches the adapter's governed object list", () => {
    const dimension = BOUNDARY_SCHEMAS.twenty!.objects!;
    expect(dimension.kind).toBe("allowlist");
    if (dimension.kind === "allowlist") {
      expect([...dimension.domain].sort()).toEqual(
        [...TWENTY_GOVERNED_OBJECTS].sort(),
      );
    }
  });
});

describe("grantInactiveReason (pure expiry logic)", () => {
  const now = new Date("2026-07-11T00:00:00.000Z");

  it("returns null for an active grant with no expiry", () => {
    expect(
      grantInactiveReason({ status: "active", expires_at: null }, now),
    ).toBeNull();
  });

  it("returns null for an active grant expiring in the future", () => {
    expect(
      grantInactiveReason(
        { status: "active", expires_at: new Date("2026-08-01T00:00:00.000Z") },
        now,
      ),
    ).toBeNull();
  });

  it("reports 'expired' when expires_at has passed, even if status is stale-active", () => {
    expect(
      grantInactiveReason(
        { status: "active", expires_at: new Date("2026-07-10T23:59:59.000Z") },
        now,
      ),
    ).toBe("expired");
  });

  it("reports 'revoked' and 'expired' statuses", () => {
    expect(
      grantInactiveReason({ status: "revoked", expires_at: null }, now),
    ).toBe("revoked");
    expect(
      grantInactiveReason({ status: "expired", expires_at: null }, now),
    ).toBe("expired");
  });
});

// getActiveGrant / requireActiveGrant / revokeGrant query real drizzle table
// objects (memory_source_authorizations); exercising them needs either the
// landed schema plus a pg test double or a dev-stage run. Deferred to dev
// verification per the U1 precedent — the pure decision logic they lean on
// (grantInactiveReason, assertBoundaryWithin) is covered above.

// ---------------------------------------------------------------------------
// urlSet boundary dimension (THINK-193 U5)
// ---------------------------------------------------------------------------

describe("normalizeExactUrl / parseUrlSetEntry", () => {
  it("normalizes host case, trailing slashes, and drops fragments", () => {
    expect(normalizeExactUrl("https://Example.com/Pricing/")).toBe(
      "https://example.com/Pricing",
    );
    expect(normalizeExactUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(normalizeExactUrl("https://example.com/a#section")).toBe(
      "https://example.com/a",
    );
    // Query strings are preserved: distinct queries are distinct pages.
    expect(normalizeExactUrl("https://example.com/a?p=2")).toBe(
      "https://example.com/a?p=2",
    );
  });

  it("rejects http, credentials, and garbage (fail closed)", () => {
    expect(() => normalizeExactUrl("http://example.com/a")).toThrow(/https/);
    expect(() => normalizeExactUrl("https://user:pw@example.com/a")).toThrow(
      /credentials/,
    );
    expect(() => normalizeExactUrl("not a url")).toThrow(/not a valid URL/);
  });

  it("parses bounded domain rules and rejects wildcards/paths/ports", () => {
    expect(parseUrlSetEntry("domain:example.com")).toEqual({
      kind: "domain",
      host: "example.com",
    });
    for (const bad of [
      "domain:*.example.com",
      "domain:example.com/path",
      "domain:example.com:8443",
      "domain:EXAMPLE.com",
      "domain:localhost",
      "domain:",
    ]) {
      expect(() => parseUrlSetEntry(bad), bad).toThrow();
    }
  });
});

describe("isUrlWithinUrlSet / resolveExactUrls", () => {
  const envelope = ["https://example.com/pricing", "domain:docs.example.com"];

  it("allows exact matches and pages under a granted domain rule", () => {
    expect(isUrlWithinUrlSet("https://example.com/pricing/", envelope)).toBe(
      true,
    );
    expect(
      isUrlWithinUrlSet("https://docs.example.com/anything/here", envelope),
    ).toBe(true);
  });

  it("rejects other paths, subdomains, and malformed urls (fail closed)", () => {
    expect(isUrlWithinUrlSet("https://example.com/blog", envelope)).toBe(false);
    // No subdomain widening: domain:docs.example.com ≠ sub.docs.example.com.
    expect(isUrlWithinUrlSet("https://sub.docs.example.com/a", envelope)).toBe(
      false,
    );
    expect(isUrlWithinUrlSet("http://example.com/pricing", envelope)).toBe(
      false,
    );
    expect(isUrlWithinUrlSet("garbage", envelope)).toBe(false);
    // An empty envelope allows nothing.
    expect(isUrlWithinUrlSet("https://example.com/pricing", [])).toBe(false);
  });

  it("resolveExactUrls keeps exact urls only — domain rules select nothing", () => {
    expect(
      resolveExactUrls([
        "https://b.com/x/",
        "https://a.com/y",
        "domain:c.com",
        "https://a.com/y#frag",
      ]),
    ).toEqual(["https://a.com/y", "https://b.com/x"]);
  });
});

describe("firecrawl boundary schema (urlSet envelope)", () => {
  it("registers the firecrawl schema with urls defaulting to []", () => {
    const schema = BOUNDARY_SCHEMAS.firecrawl!;
    expect(schema.urls).toEqual({ kind: "urlSet", default: [] });
    expect(schema.maxPages).toMatchObject({ kind: "cap", default: 5, max: 50 });
  });

  it("grant-time validation rejects malformed url values on either side", () => {
    for (const urls of [
      ["http://example.com/a"],
      ["https://u:p@example.com/a"],
      ["domain:*.example.com"],
      [42],
      "https://example.com/a",
    ]) {
      expect(() =>
        assertGrantBoundaryValid({ urls }, { sourceFamily: "firecrawl" }),
      ).toThrow(MemoryAuthorizationError);
      expect(
        within({ urls: ["https://example.com/a"] }, { urls }, "firecrawl"),
      ).toThrow(MemoryAuthorizationError);
    }
  });

  it("an omitted/empty grant urls value means NOTHING is readable", () => {
    expect(
      within({}, { urls: ["https://example.com/a"] }, "firecrawl"),
    ).toThrow(/outside the granted URL envelope/);
    expect(
      within({ urls: [] }, { urls: ["https://example.com/a"] }, "firecrawl"),
    ).toThrow(/outside the granted URL envelope/);
    // Empty config inside empty grant is fine (a run just reads nothing).
    expect(within({}, {}, "firecrawl")).not.toThrow();
  });

  it("exact config urls fit inside exact grants (normalized) and domain rules", () => {
    expect(
      within(
        { urls: ["https://Example.com/pricing/"] },
        { urls: ["https://example.com/pricing"] },
        "firecrawl",
      ),
    ).not.toThrow();
    expect(
      within(
        { urls: ["domain:example.com"] },
        { urls: ["https://example.com/pricing", "https://example.com/about"] },
        "firecrawl",
      ),
    ).not.toThrow();
    // …but not under a different host or a subdomain of the rule.
    expect(
      within(
        { urls: ["domain:example.com"] },
        { urls: ["https://www.example.com/pricing"] },
        "firecrawl",
      ),
    ).toThrow(/outside the granted URL envelope/);
  });

  it("a requested domain rule fits only inside an EQUAL granted domain rule", () => {
    expect(
      within(
        { urls: ["domain:example.com"] },
        { urls: ["domain:example.com"] },
        "firecrawl",
      ),
    ).not.toThrow();
    expect(
      within(
        { urls: ["https://example.com/pricing"] },
        { urls: ["domain:example.com"] },
        "firecrawl",
      ),
    ).toThrow(/outside the granted URL envelope/);
    expect(
      within(
        { urls: ["domain:example.com"] },
        { urls: ["domain:docs.example.com"] },
        "firecrawl",
      ),
    ).toThrow(/outside the granted URL envelope/);
  });

  it("maxPages compares as a cap envelope", () => {
    expect(
      within({ maxPages: 10 }, { maxPages: 10 }, "firecrawl"),
    ).not.toThrow();
    expect(within({ maxPages: 5 }, { maxPages: 10 }, "firecrawl")).toThrow(
      /maxPages/,
    );
  });

  it("assertSourceConfigBoundaryValid validates the config side standalone", () => {
    expect(() =>
      assertSourceConfigBoundaryValid(
        { urls: ["https://example.com/a"], maxPages: 5 },
        { sourceFamily: "firecrawl" },
      ),
    ).not.toThrow();
    expect(() =>
      assertSourceConfigBoundaryValid(
        { urls: ["http://example.com/a"] },
        { sourceFamily: "firecrawl" },
      ),
    ).toThrow(MemoryAuthorizationError);
    expect(() =>
      assertSourceConfigBoundaryValid(
        { maxRecord: 5 },
        { sourceFamily: "twenty" },
      ),
    ).toThrow(/maxRecord/);
  });
});

describe("bedrock_kb boundary schema (stringSet envelope, U7)", () => {
  const KB_A = "33333333-3333-4333-8333-333333333333";
  const KB_B = "44444444-4444-4444-8444-444444444444";

  it("allows a config KB id inside the granted identifier set", () => {
    expect(
      within(
        { knowledgeBaseIds: [KB_A, KB_B] },
        { knowledgeBaseIds: [KB_A], maxDocuments: 10 },
        "bedrock_kb",
      ),
    ).not.toThrow();
  });

  it("rejects a config KB id outside the granted set", () => {
    expect(
      within(
        { knowledgeBaseIds: [KB_A] },
        { knowledgeBaseIds: [KB_B] },
        "bedrock_kb",
      ),
    ).toThrow(/outside the granted identifier set/);
  });

  it("an empty/omitted grant allows exactly nothing", () => {
    expect(within({}, { knowledgeBaseIds: [KB_A] }, "bedrock_kb")).toThrow(
      MemoryAuthorizationError,
    );
    expect(
      within(
        { knowledgeBaseIds: [] },
        { knowledgeBaseIds: [KB_A] },
        "bedrock_kb",
      ),
    ).toThrow(MemoryAuthorizationError);
    // …and an empty config requests nothing — fine.
    expect(within({}, {}, "bedrock_kb")).not.toThrow();
  });

  it("fails closed on malformed stringSet values (either side)", () => {
    expect(
      within({ knowledgeBaseIds: ["  padded  "] }, {}, "bedrock_kb"),
    ).toThrow(/non-empty trimmed string/);
    expect(
      within({ knowledgeBaseIds: [42 as unknown as string] }, {}, "bedrock_kb"),
    ).toThrow(/not a string/);
    expect(
      within(
        { knowledgeBaseIds: [KB_A] },
        { knowledgeBaseIds: ["a".repeat(300)] },
        "bedrock_kb",
      ),
    ).toThrow(/longer than/);
    expect(
      within({ knowledgeBaseIds: "not-an-array" }, {}, "bedrock_kb"),
    ).toThrow(/array of identifier strings/);
  });

  it("enforces the maxDocuments cap envelope (1..500, default 25)", () => {
    const dim = BOUNDARY_SCHEMAS.bedrock_kb!.maxDocuments;
    expect(dim).toEqual({ kind: "cap", default: 25, min: 1, max: 500 });
    expect(
      within(
        { knowledgeBaseIds: [KB_A], maxDocuments: 50 },
        { knowledgeBaseIds: [KB_A], maxDocuments: 100 },
        "bedrock_kb",
      ),
    ).toThrow(/exceeds the grant envelope cap/);
    expect(
      within({ knowledgeBaseIds: [KB_A] }, { maxDocuments: 501 }, "bedrock_kb"),
    ).toThrow(MemoryAuthorizationError);
  });

  it("grant-time and config-time validation both name violating keys", () => {
    expect(() =>
      assertGrantBoundaryValid(
        { knowledgeBaseId: [KB_A] },
        { sourceFamily: "bedrock_kb" },
      ),
    ).toThrow(/knowledgeBaseId/);
    expect(() =>
      assertSourceConfigBoundaryValid(
        { knowledgeBaseIds: [""] },
        { sourceFamily: "bedrock_kb" },
      ),
    ).toThrow(/knowledgeBaseIds/);
  });
});
