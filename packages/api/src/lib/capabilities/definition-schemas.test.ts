import { describe, expect, it } from "vitest";
import {
  legacyPrincipalRemediation,
  parseConnectionDefinition,
  parseToolDefinition,
  parseCapabilitySidecar,
} from "./definition-schemas.js";

const md = (yaml: string, body = "Prose body.") =>
  `---\n${yaml}\n---\n${body}\n`;

const VALID_TWCAP =
  "twcap://acme/connection/firecrawl/versions/1/operations/scrape" +
  `?contract=sha256:${"a".repeat(64)}`;

describe("parseConnectionDefinition", () => {
  it("parses a valid mcp connection", () => {
    const result = parseConnectionDefinition(
      md(
        [
          "name: linear",
          "description: Linear issue tracker over MCP.",
          "type: mcp",
          "principal_type: user",
          "url: https://mcp.linear.app/sse",
          "operations:",
          "  - list_issues",
          "  - save_issue",
          "auth:",
          "  method: oauth",
          '  secret_ref: "secretsmanager:mcp-tokens/{userId}/linear"',
        ].join("\n"),
      ),
      "connections/linear/CONNECTION.md",
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.parsed.name).toBe("linear");
    expect(result.parsed.type).toBe("mcp");
    expect(result.parsed.principalType).toBe("user");
    expect(result.parsed.operations).toEqual(["list_issues", "save_issue"]);
  });

  it("defaults principal_type to app", () => {
    const result = parseConnectionDefinition(
      md("name: firecrawl\ndescription: Firecrawl API.\ntype: api"),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(result.valid && result.parsed.principalType).toBe("app");
  });

  it("rejects a literal secret in auth (R2)", () => {
    const result = parseConnectionDefinition(
      md(
        [
          "name: firecrawl",
          "description: Firecrawl API.",
          "type: api",
          "auth:",
          "  method: bearer",
          "  api_key: fc-live-abc123secret",
        ].join("\n"),
      ),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.kind === "SecretValue")).toBe(true);
  });

  it("accepts env-var-name and secretsmanager refs in secret-shaped keys", () => {
    const result = parseConnectionDefinition(
      md(
        [
          "name: firecrawl",
          "description: Firecrawl API.",
          "type: api",
          "auth:",
          "  method: bearer",
          "  api_key: FIRECRAWL_API_KEY",
          '  secret_ref: "secretsmanager:oauth/abc"',
        ].join("\n"),
      ),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts plugin-namespaced double-hyphen slugs (lastmile--crm)", () => {
    const result = parseConnectionDefinition(
      md("name: lastmile--crm\ndescription: LastMile CRM.\ntype: mcp"),
      "connections/lastmile--crm/CONNECTION.md",
    );
    expect(result.valid).toBe(true);
    // Leading/trailing hyphens stay illegal.
    expect(
      parseConnectionDefinition(
        md("name: -bad\ndescription: d\ntype: mcp"),
        "c/CONNECTION.md",
      ).valid,
    ).toBe(false);
  });

  it("parses capability_ref into a shadow descriptor identity (THINK-280 U1b)", () => {
    const mapping = parseConnectionDefinition(
      md(
        [
          "name: firecrawl",
          "description: Firecrawl API.",
          "type: api",
          "capability_ref:",
          `  twcap: "${VALID_TWCAP}"`,
          `  descriptor_fingerprint: "${"b".repeat(64)}"`,
        ].join("\n"),
      ),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(mapping.valid).toBe(true);
    if (!mapping.valid) return;
    expect(mapping.parsed.descriptor_identity).toEqual({
      twcap: VALID_TWCAP,
      descriptor_fingerprint: "b".repeat(64),
    });
    // capability_ref is a first-class field, not internal passthrough.
    expect("capability_ref" in mapping.parsed.internal).toBe(false);

    const bare = parseConnectionDefinition(
      md(
        [
          "name: firecrawl",
          "description: Firecrawl API.",
          "type: api",
          `capability_ref: "${VALID_TWCAP}"`,
        ].join("\n"),
      ),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(bare.valid && bare.parsed.descriptor_identity?.twcap).toBe(
      VALID_TWCAP,
    );

    const absent = parseConnectionDefinition(
      md("name: firecrawl\ndescription: Firecrawl API.\ntype: api"),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(absent.valid && absent.parsed.descriptor_identity).toBe(undefined);
  });

  it("fails closed on a malformed capability_ref twcap, accumulating errors", () => {
    const result = parseConnectionDefinition(
      md(
        [
          "name: firecrawl",
          "description: Firecrawl API.",
          "type: grpc",
          'capability_ref: "twcap://acme/only-two-segments?contract=nope"',
        ].join("\n"),
      ),
      "connections/firecrawl/CONNECTION.md",
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    // Accumulated alongside the unrelated `type` error — same
    // CapabilityDefinitionError channel as every other field failure.
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    const twcapError = result.errors.find(
      (e) => e.details.field === "capability_ref.twcap",
    );
    expect(twcapError?.kind).toBe("FieldShape");
  });

  it("rejects a bad descriptor_fingerprint and an empty capability_ref", () => {
    expect(
      parseConnectionDefinition(
        md(
          [
            "name: firecrawl",
            "description: d",
            "type: api",
            "capability_ref:",
            '  descriptor_fingerprint: "not-hex"',
          ].join("\n"),
        ),
        "c/CONNECTION.md",
      ).valid,
    ).toBe(false);
    expect(
      parseConnectionDefinition(
        md(
          [
            "name: firecrawl",
            "description: d",
            "type: api",
            "capability_ref: {}",
          ].join("\n"),
        ),
        "c/CONNECTION.md",
      ).valid,
    ).toBe(false);
  });

  it("never maps legacy principalType into the three-mode contract", () => {
    const result = parseConnectionDefinition(
      md("name: x\ndescription: d\ntype: mcp\nprincipal_type: user"),
      "c/CONNECTION.md",
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // The parsed value stays the legacy vocabulary verbatim…
    expect(result.parsed.principalType).toBe("user");
    expect(["requester", "agent_owner", "service"]).not.toContain(
      result.parsed.principalType,
    );
    // …and the only sanctioned bridge is the remediation marker.
    expect(legacyPrincipalRemediation(result.parsed.principalType)).toEqual({
      legacy: "user",
      remediation: "explicit-principal-migration-required",
    });
    expect(legacyPrincipalRemediation("app")).toEqual({
      legacy: "app",
      remediation: "explicit-principal-migration-required",
    });
  });

  it("rejects missing frontmatter and bad type", () => {
    expect(
      parseConnectionDefinition("just prose", "c/CONNECTION.md").valid,
    ).toBe(false);
    const badType = parseConnectionDefinition(
      md("name: x\ndescription: d\ntype: grpc"),
      "c/CONNECTION.md",
    );
    expect(badType.valid).toBe(false);
  });
});

describe("parseToolDefinition", () => {
  it("parses all four kinds", () => {
    const binding = parseToolDefinition(
      md(
        [
          "name: firecrawl-scrape",
          "description: Scrape a page via firecrawl.",
          "kind: binding",
          "connection: firecrawl",
          "operation: scrape",
          "args:",
          "  formats: [markdown]",
          "output:",
          "  model: markdown",
        ].join("\n"),
      ),
      "tools/firecrawl-scrape/TOOL.md",
    );
    expect(binding.valid).toBe(true);
    if (binding.valid && binding.parsed.kind === "binding") {
      expect(binding.parsed.connection).toBe("firecrawl");
      expect(binding.parsed.operation).toBe("scrape");
      expect(binding.parsed.presetArgs).toEqual({ formats: ["markdown"] });
      expect(binding.parsed.output?.model).toBe("markdown");
    }

    const platform = parseToolDefinition(
      md(
        "name: send-email\ndescription: Send email built-in.\nkind: platform\nplatform_tool: send_email",
      ),
      "tools/send-email/TOOL.md",
    );
    expect(platform.valid).toBe(true);
    if (platform.valid && platform.parsed.kind === "platform") {
      expect(platform.parsed.platformTool).toBe("send_email");
    }

    const extension = parseToolDefinition(
      md(
        "name: brain-search\ndescription: Brain search.\nkind: extension\nextension: thinkwork-brain\ntool: brain_search",
      ),
      "tools/brain-search/TOOL.md",
    );
    expect(extension.valid).toBe(true);

    const script = parseToolDefinition(
      md(
        "name: csv-cruncher\ndescription: Crunch CSVs.\nkind: script\nentry: run.sh",
      ),
      "tools/csv-cruncher/TOOL.md",
    );
    expect(script.valid).toBe(true);
    if (script.valid && script.parsed.kind === "script") {
      expect(script.parsed.entry).toBe("run.sh");
    }
  });

  it("rejects an unknown kind", () => {
    const result = parseToolDefinition(
      md("name: x\ndescription: d\nkind: webhook"),
      "tools/x/TOOL.md",
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]?.kind).toBe("UnknownKind");
  });

  it("rejects a binding missing its connection", () => {
    const result = parseToolDefinition(
      md("name: x\ndescription: d\nkind: binding\noperation: scrape"),
      "tools/x/TOOL.md",
    );
    expect(result.valid).toBe(false);
  });

  it("rejects literal secrets anywhere in the frontmatter (R2)", () => {
    const result = parseToolDefinition(
      md(
        [
          "name: x",
          "description: d",
          "kind: binding",
          "connection: firecrawl",
          "operation: scrape",
          "args:",
          "  api_key: sk-live-topsecret",
        ].join("\n"),
      ),
      "tools/x/TOOL.md",
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.kind === "SecretValue")).toBe(true);
  });
});

describe("parseCapabilitySidecar", () => {
  const base = {
    slug: "firecrawl",
    class: "connection",
    updated_at: "2026-07-05T00:00:00.000Z",
  };

  it("parses a minimal sidecar", () => {
    const result = parseCapabilitySidecar(
      JSON.stringify(base),
      "connections/firecrawl/.assignment.json",
    );
    expect(result.valid).toBe(true);
  });

  it("parses permissions, approval, and signed_content_sha", () => {
    const result = parseCapabilitySidecar(
      JSON.stringify({
        ...base,
        enabled: true,
        approval: "never",
        permissions: { operations: ["scrape"] },
        signed_content_sha: "a".repeat(64),
      }),
      "x/.assignment.json",
    );
    expect(result.valid).toBe(true);
  });

  it("rejects literal secrets in config (R2)", () => {
    const result = parseCapabilitySidecar(
      JSON.stringify({
        ...base,
        config: { token: "xoxb-live-secret-value" },
      }),
      "x/.assignment.json",
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.kind === "SecretValue")).toBe(true);
  });

  it("rejects malformed JSON, bad class, bad approval, bad sha", () => {
    expect(parseCapabilitySidecar("{nope", "x").valid).toBe(false);
    expect(
      parseCapabilitySidecar(JSON.stringify({ ...base, class: "skill" }), "x")
        .valid,
    ).toBe(false);
    expect(
      parseCapabilitySidecar(
        JSON.stringify({ ...base, approval: "sometimes" }),
        "x",
      ).valid,
    ).toBe(false);
    expect(
      parseCapabilitySidecar(
        JSON.stringify({ ...base, signed_content_sha: "zz" }),
        "x",
      ).valid,
    ).toBe(false);
  });
});
