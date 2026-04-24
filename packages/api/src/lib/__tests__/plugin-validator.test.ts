import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { validatePluginZip } from "../plugin-validator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function skillMd({
  name,
  description,
  allowedTools,
  body = "body",
}: {
  name: string;
  description: string;
  allowedTools?: string[];
  body?: string;
}): string {
  const lines = ["---", `name: ${name}`, `description: ${description}`];
  if (allowedTools) {
    lines.push(
      `allowed-tools: [${allowedTools.map((t) => `"${t}"`).join(", ")}]`,
    );
  }
  lines.push("---", body);
  return lines.join("\n");
}

async function buildPluginZip(
  entries: Record<string, string>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(entries)) {
    zip.file(path, text);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("validatePluginZip — happy paths", () => {
  it("accepts a 3-skill + 1-MCP plugin and carries fields through", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "my-plugin",
        version: "1.0.0",
        description: "A plugin",
        author: "tenant-tenant",
        skills: [
          "skills/alpha/SKILL.md",
          "skills/beta/SKILL.md",
          "skills/gamma/SKILL.md",
        ],
        mcpServers: [
          {
            name: "crm",
            url: "https://crm.example.test/mcp",
            description: "CRM lookup",
          },
        ],
      }),
      "skills/alpha/SKILL.md": skillMd({
        name: "alpha",
        description: "does alpha",
      }),
      "skills/beta/SKILL.md": skillMd({
        name: "beta",
        description: "does beta",
      }),
      "skills/gamma/SKILL.md": skillMd({
        name: "gamma",
        description: "does gamma",
      }),
    });

    const result = await validatePluginZip(buf);
    if (!result.valid) {
      throw new Error(
        `expected valid, got: ${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    expect(result.plugin.name).toBe("my-plugin");
    expect(result.plugin.version).toBe("1.0.0");
    expect(result.plugin.skills.map((s) => s.name).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(result.plugin.mcpServers).toEqual([
      {
        name: "crm",
        url: "https://crm.example.test/mcp",
        description: "CRM lookup",
        source: "plugin.json",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("resolves skill paths that point at directories (appending SKILL.md)", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "dir-style",
        skills: ["skills/one"],
      }),
      "skills/one/SKILL.md": skillMd({ name: "one", description: "one" }),
    });
    const result = await validatePluginZip(buf);
    if (!result.valid) throw new Error("expected valid");
    expect(result.plugin.skills[0]?.name).toBe("one");
  });

  it("warns (but does not reject) when plugin.json includes `commands`", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "with-commands",
        // biome-ignore lint/suspicious/noExplicitAny: intentional unknown shape
        commands: [
          { name: "run", description: "trigger the thing" },
        ] as unknown as never,
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": skillMd({ name: "x", description: "does x" }),
    });
    const result = await validatePluginZip(buf);
    if (!result.valid) throw new Error("expected valid with warning");
    const fieldWarning = result.warnings.find(
      (w) =>
        w.kind === "PluginFieldWarning" &&
        (w.details as { field?: string }).field === "commands",
    );
    expect(fieldWarning).toBeDefined();
  });

  it("surfaces SKILL.md allowed-tools as an informational warning", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "allowed-tools-demo",
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": skillMd({
        name: "x",
        description: "does x",
        allowedTools: ["Read", "Grep", "Skill"],
      }),
    });
    const result = await validatePluginZip(buf);
    if (!result.valid) throw new Error("expected valid");
    expect(result.plugin.allowedToolsDeclared.sort()).toEqual([
      "Grep",
      "Read",
      "Skill",
    ]);
    const atWarning = result.warnings.find(
      (w) => w.kind === "PluginAllowedToolsDeclared",
    );
    expect(atWarning).toBeDefined();
  });

  it("merges mcp.json servers with plugin.json servers, tagging source", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "dual-mcp",
        skills: ["skills/x/SKILL.md"],
        mcpServers: [{ name: "inline-srv", url: "https://inline.test/mcp" }],
      }),
      "mcp.json": JSON.stringify({
        mcpServers: [
          { name: "standalone-srv", url: "https://standalone.test/mcp" },
        ],
      }),
      "skills/x/SKILL.md": skillMd({ name: "x", description: "x" }),
    });
    const result = await validatePluginZip(buf);
    if (!result.valid) throw new Error("expected valid");
    const sources = result.plugin.mcpServers.map((s) => ({
      name: s.name,
      source: s.source,
    }));
    expect(sources).toContainEqual({
      name: "inline-srv",
      source: "plugin.json",
    });
    expect(sources).toContainEqual({
      name: "standalone-srv",
      source: "mcp.json",
    });
  });
});

// ---------------------------------------------------------------------------
// plugin.json field policy
// ---------------------------------------------------------------------------

describe("validatePluginZip — plugin.json field policy", () => {
  it("rejects a plugin whose plugin.json declares `hooks`", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "bad",
        hooks: { preInstall: "./do-something" },
      }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    const fieldErr = result.errors.find(
      (e) =>
        e.kind === "PluginFieldRejected" &&
        (e.details as { field?: string })?.field === "hooks",
    );
    expect(fieldErr).toBeDefined();
  });

  it("rejects unknown top-level fields (catches typos that would be silently dropped)", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "bad",
        mcpserver: [{ name: "oops", url: "x" }], // typo of mcpServers
      }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(
      result.errors.some(
        (e) =>
          e.kind === "PluginFieldRejected" &&
          (e.details as { field?: string })?.field === "mcpserver",
      ),
    ).toBe(true);
  });

  it("rejects when plugin.json is missing the required `name` field", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({ version: "1.0.0" }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "PluginMissingRequired")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// SKILL.md validation
// ---------------------------------------------------------------------------

describe("validatePluginZip — SKILL.md validation", () => {
  it("rejects SKILL.md whose name contains 'claude' (Anthropic-reserved)", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "p",
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": skillMd({ name: "claude-bot", description: "nope" }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "SkillMdNameReserved")).toBe(
      true,
    );
  });

  it("rejects SKILL.md whose name contains 'anthropic' (Anthropic-reserved)", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "p",
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": skillMd({
        name: "anthropic-thing",
        description: "nope",
      }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "SkillMdNameReserved")).toBe(
      true,
    );
  });

  it("rejects SKILL.md whose name exceeds 64 chars", async () => {
    const longName = "a".repeat(65);
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "p",
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": skillMd({ name: longName, description: "ok" }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "SkillMdFieldTooLong")).toBe(
      true,
    );
  });

  it("rejects SKILL.md whose name has uppercase or punctuation", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "p",
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": skillMd({ name: "Bad_Name", description: "ok" }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "SkillMdFieldShape")).toBe(
      true,
    );
  });

  it("rejects SKILL.md missing required description, identifies file by path", async () => {
    const source = ["---", "name: x", "---", "body"].join("\n");
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "p",
        skills: ["skills/x/SKILL.md"],
      }),
      "skills/x/SKILL.md": source,
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    const descErr = result.errors.find(
      (e) =>
        e.kind === "SkillMdMissingField" &&
        (e.details as { field?: string })?.field === "description",
    );
    expect(descErr).toBeDefined();
    // The error carries the offending path so operators can jump to it.
    expect((descErr?.details as { path?: string })?.path).toBe(
      "skills/x/SKILL.md",
    );
  });

  it("rejects when plugin.json references a skill that isn't in the zip", async () => {
    const buf = await buildPluginZip({
      "plugin.json": JSON.stringify({
        name: "drift",
        skills: ["skills/missing/SKILL.md"],
      }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "PluginMissingSkill")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Malformed archive / JSON
// ---------------------------------------------------------------------------

describe("validatePluginZip — malformed input", () => {
  it("rejects non-zip buffers with ZipMalformed", async () => {
    const result = await validatePluginZip(Buffer.from("not a zip"));
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "ZipMalformed")).toBe(true);
  });

  it("rejects plugin.json that isn't valid JSON", async () => {
    const buf = await buildPluginZip({ "plugin.json": "{ this is not json" });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.errors.some((e) => e.kind === "PluginMalformedJson")).toBe(
      true,
    );
  });

  it("rejects archive that has no plugin.json at all", async () => {
    const buf = await buildPluginZip({
      "skills/x/SKILL.md": skillMd({ name: "x", description: "x" }),
    });
    const result = await validatePluginZip(buf);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(
      result.errors.some((e) => e.kind === "PluginMissingPluginJson"),
    ).toBe(true);
  });
});
