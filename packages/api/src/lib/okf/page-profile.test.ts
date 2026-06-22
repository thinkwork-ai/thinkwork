import { describe, expect, it } from "vitest";
import {
  assertValidOkfPageProfile,
  okfTypeForPageKind,
  validateOkfPageProfile,
  type OkfPageKind,
  type OkfPageProfile,
} from "./page-profile.js";

const BASE_TIME = "2026-06-22T15:00:00.000Z";

function profile(kind: OkfPageKind): OkfPageProfile {
  return {
    path:
      kind === "entity"
        ? "entities/customer/acme-corp.md"
        : `${kind}s/acme-${kind}.md`,
    frontmatter: {
      type: okfTypeForPageKind(kind),
      title: `Acme ${kind}`,
      description: "Generated from governed ThinkWork state.",
      resource: `thinkwork://brain/${kind}/acme-${kind}`,
      tags: ["company-brain", kind],
      timestamp: BASE_TIME,
      "x-thinkwork": {
        version: 1,
        tenant_scope: "tenant",
        surface: kind === "source" ? "wiki" : "brain",
        page_kind: kind,
        entity_type: kind === "entity" ? "customer" : null,
        slug: `acme-${kind}`,
        status: "active",
        ontology_version: "ontology:2026-06-20",
        source_bundle_version: "brain-bundle:2026-06-22T15:00:00Z",
        provenance_refs: [
          {
            kind: "artifact_manifest",
            id: "manifest_redacted_hash",
            checksumSha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        ],
        relationships: [
          {
            rel: "related_to",
            target: "../topics/acme-expansion.md",
          },
        ],
        redaction: {
          posture: "tenant_visible",
          raw_source_ids_redacted: true,
        },
      },
    },
    bodyMarkdown: "# Acme\n\nSource data (untrusted; cite or summarize only).",
  };
}

describe("OKF page profile validation", () => {
  it.each(["entity", "topic", "decision", "source"] as const)(
    "accepts valid %s page profiles",
    (kind) => {
      const page = profile(kind);
      expect(validateOkfPageProfile(page)).toEqual({
        ok: true,
        value: page,
        errors: [],
      });
      expect(assertValidOkfPageProfile(page)).toBe(page);
    },
  );

  it("rejects missing type and x-thinkwork metadata", () => {
    const candidate = profile("entity") as any;
    delete candidate.frontmatter.type;
    delete candidate.frontmatter["x-thinkwork"];

    const result = validateOkfPageProfile(candidate);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "frontmatter.type must be a non-empty trimmed string",
        "frontmatter.x-thinkwork is required",
      ]),
    );
  });

  it("rejects unsafe generated paths and relationship targets", () => {
    const candidate = profile("topic");
    candidate.path = "../secrets.md";
    candidate.frontmatter["x-thinkwork"].relationships = [
      { rel: "leaks", target: "/mnt/thinkwork-okf/tenant/current/source.md" },
    ];

    const result = validateOkfPageProfile(candidate);

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "path contains an unsafe path segment",
    );
    expect(result.errors.join("\n")).toContain(
      "relationships[0].target must be relative",
    );
  });

  it("requires citation and redaction metadata", () => {
    const candidate = profile("decision");
    (candidate.frontmatter["x-thinkwork"] as any).surface = "spreadsheet";
    candidate.frontmatter["x-thinkwork"].provenance_refs = [];
    candidate.frontmatter["x-thinkwork"].redaction.raw_source_ids_redacted =
      false;

    const result = validateOkfPageProfile(candidate);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "frontmatter.x-thinkwork.surface must be one of wiki, brain, memory, knowledge_graph",
        "frontmatter.x-thinkwork.provenance_refs must not be empty",
        "frontmatter.x-thinkwork.redaction.raw_source_ids_redacted must be true",
      ]),
    );
  });

  it("keeps OKF type aligned with ThinkWork page kind", () => {
    const candidate = profile("source");
    candidate.frontmatter.type = "ThinkWorkEntity";

    const result = validateOkfPageProfile(candidate);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "frontmatter.type must be ThinkWorkSource for source pages",
    );
  });
});
