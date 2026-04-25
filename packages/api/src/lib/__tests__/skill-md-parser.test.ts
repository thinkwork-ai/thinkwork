/**
 * Frontmatter-shape tests for the thinkwork-internal extension of the
 * SKILL.md parser (plan 2026-04-24-009 §U1).
 *
 * Two surfaces under test:
 *   - `parseSkillMd` — strict, used by the SI-4 plugin upload boundary.
 *     Now also validates the `execution` field (rejects `composition`,
 *     accepts `script` / `context`, defaults missing to `null`) and
 *     preserves every other thinkwork-internal field on `parsed.internal`.
 *   - `parseSkillMdInternal` — lenient, used by thinkwork-shipped
 *     catalog loaders. Tolerates SKILL.md with no frontmatter (returns
 *     `frontmatterPresent: false` + empty `data`) and does not enforce
 *     `name`/`description`. Still rejects malformed YAML and
 *     `execution: composition`.
 */

import { describe, expect, it } from "vitest";

import {
  parseSkillMd,
  parseSkillMdInternal,
} from "../skill-md-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function md(frontmatter: string, body = "body"): string {
  return ["---", frontmatter, "---", body].join("\n");
}

// Full canonical frontmatter exercising every supported internal field.
// Used by the "happy path — full frontmatter" tests below to pin the
// preserve-verbatim contract.
const FULL_FRONTMATTER = `name: full-skill
description: A skill with every supported field populated.
version: "2.1.0"
license: Proprietary
display_name: Full Skill
metadata:
  author: thinkwork
  version: "2.1.0"
execution: script
mode: tool
model: anthropic.claude-3-5-sonnet
scripts:
  - name: do_thing
    path: scripts/do_thing.py
    description: "Does the thing"
    default_enabled: true
inputs:
  customer:
    type: string
    required: true
    resolver: resolve_customer
    on_missing_input: ask
  focus:
    type: enum
    values: [financial, expansion, risks, general]
    default: general
triggers:
  chat_intent:
    examples:
      - "do the thing for {customer}"
    disambiguation: ask
  schedule:
    type: cron
    expression: "0 14 ? * MON-FRI *"
    bindings:
      customer:
        from_tenant_config: default_customer
  webhook:
    examples:
      - "POST /thing"
tenant_overridable:
  - inputs.focus.default
  - triggers.schedule.expression
requires_skills:
  - package
  - web-search
permissions_model: operations
category: productivity
icon: sparkle
tags: [example, full, productivity]
requires_env:
  - THINKWORK_API_URL
  - THINKWORK_API_SECRET
oauth_provider: google_productivity
oauth_scopes: [gmail, calendar, identity]
mcp_server: example-mcp
mcp_tools: [tool_a, tool_b]
dependencies:
  - other-skill
is_default: true
compatibility: Requires Google OAuth credentials
allowed-tools:
  - render_package
  - hindsight_recall`;

// ---------------------------------------------------------------------------
// parseSkillMd (strict — SI-4 surface) — happy paths
// ---------------------------------------------------------------------------

describe("parseSkillMd — happy paths", () => {
  it("parses minimal frontmatter (name + description only)", () => {
    const r = parseSkillMd(
      md("name: minimal\ndescription: just the basics"),
      "skills/minimal/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.name).toBe("minimal");
    expect(r.parsed.description).toBe("just the basics");
    expect(r.parsed.allowedToolsDeclared).toEqual([]);
    expect(r.parsed.execution).toBeNull();
    expect(r.parsed.internal).toEqual({});
    expect(r.parsed.body).toBe("body");
  });

  it("parses full frontmatter and preserves every internal field on .internal", () => {
    const r = parseSkillMd(md(FULL_FRONTMATTER), "skills/full/SKILL.md");
    if (!r.valid) throw new Error("expected valid");

    expect(r.parsed.name).toBe("full-skill");
    expect(r.parsed.execution).toBe("script");
    expect(r.parsed.allowedToolsDeclared).toEqual([
      "render_package",
      "hindsight_recall",
    ]);
    // Internal carries everything except name/description/allowed-tools.
    const internal = r.parsed.internal ?? {};
    expect(internal.execution).toBe("script");
    expect(internal.mode).toBe("tool");
    expect(internal.model).toBe("anthropic.claude-3-5-sonnet");
    expect(internal.permissions_model).toBe("operations");
    expect(internal.is_default).toBe(true);
    expect(internal.category).toBe("productivity");
    expect(internal.tags).toEqual(["example", "full", "productivity"]);
    expect(internal.oauth_scopes).toEqual(["gmail", "calendar", "identity"]);
    expect(Array.isArray(internal.scripts)).toBe(true);
    expect((internal.scripts as Array<Record<string, unknown>>)[0]).toMatchObject(
      {
        name: "do_thing",
        path: "scripts/do_thing.py",
        default_enabled: true,
      },
    );
    expect((internal.inputs as Record<string, unknown>).customer).toMatchObject({
      type: "string",
      required: true,
    });
    expect(
      (internal.triggers as Record<string, Record<string, unknown>>).schedule
        .expression,
    ).toBe("0 14 ? * MON-FRI *");
    // Stripped fields must NOT leak into .internal.
    expect(internal.name).toBeUndefined();
    expect(internal.description).toBeUndefined();
    expect(internal["allowed-tools"]).toBeUndefined();
  });

  it("accepts execution: context explicitly", () => {
    const r = parseSkillMd(
      md("name: ctx\ndescription: context skill\nexecution: context"),
      "skills/ctx/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.execution).toBe("context");
  });

  it("treats execution: '' (empty string) as absent — defaults via null", () => {
    // YAML's `execution:` (empty value) parses as null. Authors who
    // write `execution: ""` should land on the same path.
    const r = parseSkillMd(
      md('name: empty-exec\ndescription: ok\nexecution: ""'),
      "skills/empty/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.execution).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSkillMd — required-field rejections (SI-4 contract preservation)
// ---------------------------------------------------------------------------

describe("parseSkillMd — required-field rejections", () => {
  it("rejects when 'name' is missing", () => {
    const r = parseSkillMd(
      md("description: no name here"),
      "skills/no-name/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    expect(
      r.errors.some(
        (e) =>
          e.kind === "SkillMdMissingField" &&
          (e.details as { field?: string }).field === "name",
      ),
    ).toBe(true);
  });

  it("rejects malformed name with caps + spaces (INVALID_NAME_FORMAT analog)", () => {
    const r = parseSkillMd(
      md('name: "Account Health Review"\ndescription: bad'),
      "skills/bad-name/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    const shapeErr = r.errors.find((e) => e.kind === "SkillMdFieldShape");
    expect(shapeErr).toBeDefined();
    expect((shapeErr?.details as { field?: string }).field).toBe("name");
  });

  it("rejects when 'description' is missing", () => {
    const r = parseSkillMd(md("name: x"), "skills/x/SKILL.md");
    if (r.valid) throw new Error("expected invalid");
    expect(
      r.errors.some(
        (e) =>
          e.kind === "SkillMdMissingField" &&
          (e.details as { field?: string }).field === "description",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSkillMd — execution drift rejection (U6 audit tripwire)
// ---------------------------------------------------------------------------

describe("parseSkillMd — execution validation", () => {
  it("rejects execution: composition with SkillMdUnsupportedExecution", () => {
    const r = parseSkillMd(
      md(
        "name: legacy\ndescription: would-be composition\nexecution: composition",
      ),
      "skills/legacy/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    const err = r.errors.find((e) => e.kind === "SkillMdUnsupportedExecution");
    expect(err).toBeDefined();
    expect((err?.details as { value?: string }).value).toBe("composition");
  });

  it("rejects an arbitrary unknown execution value", () => {
    const r = parseSkillMd(
      md("name: weird\ndescription: weird\nexecution: parallel"),
      "skills/weird/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    expect(
      r.errors.some((e) => e.kind === "SkillMdUnsupportedExecution"),
    ).toBe(true);
  });

  it("rejects non-string execution (type drift)", () => {
    const r = parseSkillMd(
      md("name: weird\ndescription: weird\nexecution: 1"),
      "skills/weird-type/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    const err = r.errors.find(
      (e) =>
        e.kind === "SkillMdFieldType" &&
        (e.details as { field?: string }).field === "execution",
    );
    expect(err).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// parseSkillMd — malformed YAML / structural rejections
// ---------------------------------------------------------------------------

describe("parseSkillMd — malformed input", () => {
  it("rejects malformed YAML and carries the path through", () => {
    // `:` after the bare key with an opening `{` and no close confuses
    // the YAML parser deterministically.
    const source = ["---", "name: x", "description: {", "---", "body"].join(
      "\n",
    );
    const r = parseSkillMd(source, "skills/bad-yaml/SKILL.md");
    if (r.valid) throw new Error("expected invalid");
    const err = r.errors.find((e) => e.kind === "SkillMdMalformedFrontmatter");
    expect(err).toBeDefined();
    expect(err?.message).toContain("skills/bad-yaml/SKILL.md");
  });

  it("rejects strict-mode parse when the file has no frontmatter", () => {
    // The SI-4 surface treats no-frontmatter as a misnamed README — see
    // skill-md-parser.ts header. The lenient parser below tolerates it.
    const r = parseSkillMd(
      "# Just a body, no frontmatter\n",
      "skills/bare/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    expect(r.errors.some((e) => e.kind === "SkillMdMissingFrontmatter")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// parseSkillMdInternal (lenient — thinkwork-internal callers)
// ---------------------------------------------------------------------------

describe("parseSkillMdInternal — happy paths", () => {
  it("parses minimal frontmatter and exposes raw data verbatim", () => {
    const r = parseSkillMdInternal(
      md("name: minimal\ndescription: just the basics"),
      "skills/minimal/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.frontmatterPresent).toBe(true);
    expect(r.parsed.data).toEqual({
      name: "minimal",
      description: "just the basics",
    });
    expect(r.parsed.execution).toBeNull();
    expect(r.parsed.body).toBe("body");
  });

  it("parses full frontmatter and preserves every field including name/description/allowed-tools", () => {
    const r = parseSkillMdInternal(md(FULL_FRONTMATTER), "skills/full/SKILL.md");
    if (!r.valid) throw new Error("expected valid");
    // Lenient parser keeps the full mapping — callers index by key.
    expect(r.parsed.data.name).toBe("full-skill");
    expect(r.parsed.data.description).toContain("every supported field");
    expect(r.parsed.data["allowed-tools"]).toEqual([
      "render_package",
      "hindsight_recall",
    ]);
    expect(r.parsed.execution).toBe("script");
    expect(
      (r.parsed.data.scripts as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      name: "do_thing",
      default_enabled: true,
    });
    // Bool/int coercion — pyyaml + js `yaml` both do this natively;
    // pin it here so any future YAML-lib swap can't silently regress.
    expect(typeof r.parsed.data.is_default).toBe("boolean");
    expect(r.parsed.data.is_default).toBe(true);
  });
});

describe("parseSkillMdInternal — missing-frontmatter tolerance", () => {
  it("returns empty data + frontmatterPresent: false when no '---' block exists", () => {
    const r = parseSkillMdInternal(
      "# Customer Onboarding\n\nSome prose body.\n",
      "skills/customer-onboarding/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.frontmatterPresent).toBe(false);
    expect(r.parsed.data).toEqual({});
    expect(r.parsed.execution).toBeNull();
    // Body holds the whole source so callers can still surface prose.
    expect(r.parsed.body).toContain("Customer Onboarding");
  });

  it("treats empty frontmatter (---\\n---) as present-but-empty", () => {
    const r = parseSkillMdInternal(
      "---\n---\nbody\n",
      "skills/empty-fm/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.frontmatterPresent).toBe(true);
    expect(r.parsed.data).toEqual({});
  });

  it("does NOT enforce name/description (lenient — caller decides)", () => {
    const r = parseSkillMdInternal(
      md("category: productivity\nexecution: script"),
      "skills/no-name-no-desc/SKILL.md",
    );
    if (!r.valid) throw new Error("expected valid");
    expect(r.parsed.data.category).toBe("productivity");
    expect(r.parsed.execution).toBe("script");
  });
});

describe("parseSkillMdInternal — rejections", () => {
  it("rejects malformed YAML with file path in the message", () => {
    const source = ["---", "name: x", "description: {", "---", "body"].join(
      "\n",
    );
    const r = parseSkillMdInternal(source, "skills/bad-yaml/SKILL.md");
    if (r.valid) throw new Error("expected invalid");
    const err = r.errors.find((e) => e.kind === "SkillMdMalformedFrontmatter");
    expect(err).toBeDefined();
    expect(err?.message).toContain("skills/bad-yaml/SKILL.md");
  });

  it("rejects execution: composition (U6 audit tripwire)", () => {
    const r = parseSkillMdInternal(
      md("name: legacy\ndescription: legacy\nexecution: composition"),
      "skills/legacy/SKILL.md",
    );
    if (r.valid) throw new Error("expected invalid");
    expect(
      r.errors.some((e) => e.kind === "SkillMdUnsupportedExecution"),
    ).toBe(true);
  });

  it("rejects frontmatter that parses to a non-mapping (e.g. a list)", () => {
    const source = ["---", "- a", "- b", "---", "body"].join("\n");
    const r = parseSkillMdInternal(source, "skills/list-fm/SKILL.md");
    if (r.valid) throw new Error("expected invalid");
    expect(
      r.errors.some((e) => e.kind === "SkillMdMalformedFrontmatter"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-parser agreement on shared cases
// ---------------------------------------------------------------------------

describe("parser cross-agreement", () => {
  it("both parsers reject execution: composition", () => {
    const source = md(
      "name: legacy\ndescription: legacy\nexecution: composition",
    );
    const strict = parseSkillMd(source, "p");
    const lenient = parseSkillMdInternal(source, "p");
    expect(strict.valid).toBe(false);
    expect(lenient.valid).toBe(false);
  });

  it("both parsers coerce scripts[].default_enabled: true to boolean true", () => {
    const source = md(
      [
        "name: gcal",
        "description: g",
        "execution: script",
        "scripts:",
        "  - name: do_thing",
        "    path: scripts/x.py",
        "    default_enabled: true",
      ].join("\n"),
    );
    const strict = parseSkillMd(source, "p");
    const lenient = parseSkillMdInternal(source, "p");
    if (!strict.valid) throw new Error("strict invalid");
    if (!lenient.valid) throw new Error("lenient invalid");
    const strictScript = (
      (strict.parsed.internal ?? {}).scripts as Array<Record<string, unknown>>
    )[0];
    const lenientScript = (
      lenient.parsed.data.scripts as Array<Record<string, unknown>>
    )[0];
    expect(strictScript.default_enabled).toBe(true);
    expect(lenientScript.default_enabled).toBe(true);
    expect(typeof strictScript.default_enabled).toBe("boolean");
    expect(typeof lenientScript.default_enabled).toBe("boolean");
  });
});
