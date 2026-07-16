/**
 * Marker behavioral-config frontmatter tests (THINK-302 U2 — R4, R7, R10).
 *
 * The byte-stability tests are load-bearing: the approval registry pins
 * marker_sha over serialized bytes, and the backfill's deterministic merge
 * depends on identical logical input producing identical bytes.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseMarkerConfig,
  parseMcpDefinition,
  serializeMcpDefinition,
  validateMarkerConfigFields,
} from "./marker-frontmatter.js";
import { parseAgentFolderInstructions } from "../agent-folder-format.js";
import type { CapabilityDefinitionError } from "./definition-schemas.js";

const PATH = "mcp/dagster/MCP.md";

function sha(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("validateMarkerConfigFields", () => {
  it("parses the full shared config subset", () => {
    const errors: CapabilityDefinitionError[] = [];
    const parsed = validateMarkerConfigFields(
      {
        approval: "always",
        operations: ["runs.launch", "runs.read"],
        rate_limit_rpm: 30,
        model_override: "claude-haiku-4-5",
        config: { oauth_wiring: "ref:tenant-github-app" },
      },
      PATH,
      errors,
    );
    expect(errors).toEqual([]);
    expect(parsed).toEqual({
      approval: "always",
      operations: ["runs.launch", "runs.read"],
      rateLimitRpm: 30,
      modelOverride: "claude-haiku-4-5",
      config: { oauth_wiring: "ref:tenant-github-app" },
    });
  });

  it("defaults approval to never when absent", () => {
    const errors: CapabilityDefinitionError[] = [];
    const parsed = validateMarkerConfigFields({}, PATH, errors);
    expect(errors).toEqual([]);
    expect(parsed.approval).toBe("never");
  });

  it("rejects an invalid approval enum value", () => {
    const errors: CapabilityDefinitionError[] = [];
    validateMarkerConfigFields({ approval: "sometimes" }, PATH, errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("FieldShape");
    expect(errors[0]!.message).toContain("never|once|always");
  });

  it("rejects non-positive rate_limit_rpm", () => {
    const errors: CapabilityDefinitionError[] = [];
    validateMarkerConfigFields({ rate_limit_rpm: 0 }, PATH, errors);
    validateMarkerConfigFields({ rate_limit_rpm: 1.5 }, PATH, errors);
    expect(errors).toHaveLength(2);
  });

  it("rejects secret-looking wiring-ref values by shape, not just key name", () => {
    for (const value of [
      "AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIB",
      "ghp_abcdefghijklmnop1234",
      "xoxb-1234567890-abcdef",
    ]) {
      const errors: CapabilityDefinitionError[] = [];
      validateMarkerConfigFields(
        { config: { innocuous_ref: value } },
        PATH,
        errors,
      );
      expect(
        errors.some((error) => error.kind === "SecretValue"),
        `expected SecretValue for ${value.slice(0, 12)}…`,
      ).toBe(true);
    }
  });

  it("accepts reference shapes on secret-shaped keys", () => {
    const errors: CapabilityDefinitionError[] = [];
    validateMarkerConfigFields(
      {
        config: {
          api_key: "secretsmanager:/thinkwork/dev/dagster-key",
          token: "DAGSTER_TOKEN_ENV",
        },
      },
      PATH,
      errors,
    );
    expect(errors).toEqual([]);
  });
});

describe("parseMarkerConfig", () => {
  it("hard-errors on unknown keys, naming the key", () => {
    const result = parseMarkerConfig({ approval: "once", enabled: true }, PATH);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.message).toContain("'enabled'");
    }
  });
});

describe("parseMcpDefinition", () => {
  const VALID = `---
name: dagster
description: Dagster orchestration MCP
server: 6a3d9c1e-registry-ref
enabled_tools:
  - launch_run
  - get_run_status
approval: once
---

Use for pipeline operations.
`;

  it("parses a valid MCP.md to a typed definition", () => {
    const result = parseMcpDefinition(VALID, PATH);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.parsed.name).toBe("dagster");
      expect(result.parsed.server).toBe("6a3d9c1e-registry-ref");
      expect(result.parsed.enabledTools).toEqual([
        "launch_run",
        "get_run_status",
      ]);
      expect(result.parsed.approval).toBe("once");
      expect(result.parsed.body).toBe("Use for pipeline operations.");
    }
  });

  it("requires frontmatter", () => {
    const result = parseMcpDefinition("just prose\n", PATH);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.kind).toBe("MissingFrontmatter");
    }
  });

  it("requires name, description, and server", () => {
    const result = parseMcpDefinition("---\napproval: once\n---\nbody\n", PATH);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((error) => error.details.field);
      expect(fields).toContain("name");
      expect(fields).toContain("description");
      expect(fields).toContain("server");
    }
  });

  it("rejects 'enabled' with the presence-is-the-grant rule", () => {
    const result = parseMcpDefinition(
      "---\nname: dagster\ndescription: d\nserver: s\nenabled: false\n---\n",
      PATH,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.message).toContain("folder presence is");
    }
  });

  it("hard-errors on unknown keys", () => {
    const result = parseMcpDefinition(
      "---\nname: dagster\ndescription: d\nserver: s\nregistryServerId: x\n---\n",
      PATH,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.message).toContain("'registryServerId'");
    }
  });
});

describe("serializeMcpDefinition — byte stability", () => {
  const input = {
    name: "dagster",
    description: "Dagster orchestration MCP",
    server: "6a3d9c1e-registry-ref",
    enabledTools: ["launch_run", "get_run_status"],
    approval: "once" as const,
    config: { wiring: "ref:dagster-cloud", api_base: "ssm:/dagster/base" },
    body: "Use for pipeline operations.",
  };

  it("same input twice → identical bytes → identical sha", () => {
    const first = serializeMcpDefinition(input);
    const second = serializeMcpDefinition({ ...input });
    expect(first).toBe(second);
    expect(sha(first)).toBe(sha(second));
  });

  it("round-trips: parse(serialize(x)) reserializes to identical bytes", () => {
    const bytes = serializeMcpDefinition(input);
    const parsed = parseMcpDefinition(bytes, PATH);
    expect(parsed.valid).toBe(true);
    if (parsed.valid) {
      const again = serializeMcpDefinition({
        name: parsed.parsed.name,
        description: parsed.parsed.description,
        server: parsed.parsed.server,
        enabledTools: parsed.parsed.enabledTools,
        approval: parsed.parsed.approval,
        operations: parsed.parsed.operations,
        rateLimitRpm: parsed.parsed.rateLimitRpm,
        modelOverride: parsed.parsed.modelOverride,
        config: parsed.parsed.config,
        body: parsed.parsed.body,
      });
      expect(again).toBe(bytes);
    }
  });

  it("elides defaults: approval never is not written", () => {
    const bytes = serializeMcpDefinition({
      name: "dagster",
      description: "d",
      server: "s",
      approval: "never",
    });
    expect(bytes).not.toContain("approval");
  });

  it("config keys serialize sorted regardless of input order", () => {
    const a = serializeMcpDefinition({
      ...input,
      config: { b_ref: "ref:b", a_ref: "ref:a" },
    });
    const b = serializeMcpDefinition({
      ...input,
      config: { a_ref: "ref:a", b_ref: "ref:b" },
    });
    expect(a).toBe(b);
  });
});

describe("INSTRUCTIONS.md trust fields (agent-folder-format extension)", () => {
  const path = "agents/researcher/INSTRUCTIONS.md";

  it("parses approval + operations alongside the existing keys", () => {
    const result = parseAgentFolderInstructions(
      `---
description: Deep-research delegate
approval: always
operations:
  - web-search
---

Do research.
`,
      path,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.parsed.approval).toBe("always");
      expect(result.parsed.operations).toEqual(["web-search"]);
    }
  });

  it("defaults approval to never and keeps strict unknown-key errors", () => {
    const ok = parseAgentFolderInstructions(
      "---\ndescription: d\n---\n\nbody\n",
      path,
    );
    expect(ok.valid).toBe(true);
    if (ok.valid) expect(ok.parsed.approval).toBe("never");

    const bad = parseAgentFolderInstructions(
      "---\ndescription: d\nrate_limit_rpm: 5\n---\n\nbody\n",
      path,
    );
    expect(bad.valid).toBe(false);
    if (!bad.valid) {
      expect(bad.errors[0]!.message).toContain("'rate_limit_rpm'");
    }
  });

  it("rejects a bad approval enum in INSTRUCTIONS.md", () => {
    const result = parseAgentFolderInstructions(
      "---\ndescription: d\napproval: sometimes\n---\n\nbody\n",
      path,
    );
    expect(result.valid).toBe(false);
  });
});
