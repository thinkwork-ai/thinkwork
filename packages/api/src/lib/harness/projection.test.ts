import { describe, expect, it } from "vitest";
import {
  deriveHarnessName,
  projectHarnessConfig,
  type HarnessProjectionInput,
} from "./projection.js";

/**
 * Reference-run fixture from the U1 dossier (TEI thread
 * a97275ae-4152-41a0-bf1b-9afe4f8abfed → "QBR: 777 Automotive"):
 * kimi-k2.5 on Bedrock, one MCP server (lastmile-data, tool `query`,
 * service-credential bearer auth), document-composer skill, platform
 * default skills, all platform toggles enabled but unexercised.
 */
function referenceInput(): HarnessProjectionInput {
  return {
    tenantId: "2d09efbb-4f45-4ead-9f50-6c74c55a5e5f",
    agentId: "1c1aa45a-f80d-4492-87a4-7b6dfe858790",
    agentSlug: "thinkwork-agent",
    systemPrompt: "You are ThinkWork, the tenant platform agent.",
    modelId: "moonshotai.kimi-k2.5",
    modelProvider: "bedrock",
    skills: [
      {
        skillId: "document-composer",
        s3Key: "tenants/tei/agents/thinkwork-agent/skills/document-composer",
      },
      {
        skillId: "artifacts",
        s3Key: "tenants/tei/skill-catalog/artifacts",
        envOverrides: { THINKWORK_API_SECRET: "shhh" },
      },
      {
        skillId: "agent-thread-management",
        s3Key: "tenants/tei/skill-catalog/agent-thread-management",
      },
      {
        skillId: "workspace-memory",
        s3Key: "tenants/tei/skill-catalog/workspace-memory",
      },
      {
        skillId: "web-search",
        s3Key: "tenants/tei/skill-catalog/web-search",
      },
    ],
    mcpConfigs: [
      {
        name: "lastmile-data",
        url: "https://8puq24dl63.execute-api.us-east-1.amazonaws.com/mcp/analyst/lastmile-data",
        transport: "streamable-http",
        auth: { type: "bearer", token: "broker-token" },
        tools: ["query"],
        availableTools: ["query"],
      },
    ],
    manifestFingerprint:
      "0066590a10f7da641a74e0f24d1b71b4a683bf18f9f7616a82e68fb087db512b",
    configFingerprint: "cfg-fingerprint-1",
    emitDocument: {
      description: "Emit a ThinkWork plate document (genre qbr, ...).",
      inputSchema: {
        type: "object",
        properties: { genre: { type: "string" }, title: { type: "string" } },
        required: ["genre", "title"],
      },
    },
    workspaceBucket: "thinkwork-tei-e2e-storage",
    capabilitySurface: {
      piExtensionCount: 0,
      agentProfileSlugs: ["research", "coding", "reviewer", "analyst"],
      browserAutomationEnabled: false,
      sandboxConfigured: false,
      guardrailConfigured: false,
      sendEmailEnabled: true,
      webSearchEnabled: true,
      webExtractEnabled: true,
      contextEngineEnabled: true,
      jsonRenderUiEnabled: true,
      knowledgeGraphEnabled: true,
      attachmentCount: 0,
    },
  };
}

describe("projectHarnessConfig — reference-run happy path", () => {
  it("projects the dossier fixture to a complete Harness config", () => {
    const result = projectHarnessConfig(referenceInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { config } = result;

    expect(config.harnessName).toMatch(/^tw_thinkwork_agent_[0-9a-f]{10}$/);
    expect(config.model).toEqual({
      bedrockModelConfig: { modelId: "moonshotai.kimi-k2.5" },
    });
    expect(config.tools).toEqual([
      {
        type: "mcp",
        name: "lastmile-data",
        remoteMcp: {
          url: "https://8puq24dl63.execute-api.us-east-1.amazonaws.com/mcp/analyst/lastmile-data",
          headers: { Authorization: "Bearer broker-token" },
        },
      },
      {
        type: "inline_function",
        name: "emit_document",
        inlineFunction: {
          description: "Emit a ThinkWork plate document (genre qbr, ...).",
          inputSchema: expect.objectContaining({ type: "object" }),
        },
      },
    ]);
    // Connector narrowing (operations: ["query"]) becomes allowedTools.
    expect(config.allowedTools).toEqual([
      "@lastmile-data/query",
      "emit_document",
      "@builtin",
    ]);
    // Only the real content skill materializes; platform skills are
    // recorded exclusions, never silent drops.
    expect(config.skillMaterializations).toEqual([
      {
        slug: "document-composer",
        sourceS3Uri:
          "s3://thinkwork-tei-e2e-storage/tenants/tei/agents/thinkwork-agent/skills/document-composer/",
        hasSkillMd: true,
      },
    ]);
    const excluded = config.evidence.exclusions.map((e) => e.capability);
    expect(excluded).toEqual(
      expect.arrayContaining([
        "skill:artifacts",
        "skill:agent-thread-management",
        "skill:workspace-memory",
        "send_email",
        "web_search",
        "web_extract",
        "context_engine",
        "json_render_ui_canvas",
        "knowledge_graph",
        "sub_agent_delegation:research,coding,reviewer,analyst",
      ]),
    );
    expect(config.evidence.manifestFingerprint).toBe(
      "0066590a10f7da641a74e0f24d1b71b4a683bf18f9f7616a82e68fb087db512b",
    );
    expect(config.evidence.projectionFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic, and the projection fingerprint tracks config content", () => {
    const first = projectHarnessConfig(referenceInput());
    const second = projectHarnessConfig(referenceInput());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.config.evidence.projectionFingerprint).toBe(
      second.config.evidence.projectionFingerprint,
    );

    const changed = projectHarnessConfig({
      ...referenceInput(),
      systemPrompt: "Different prompt.",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.config.evidence.projectionFingerprint).not.toBe(
      first.config.evidence.projectionFingerprint,
    );
  });
});

describe("projectHarnessConfig — AE2 rejections name the capability", () => {
  it("rejects a guardrail-required agent (Harness carries no guardrail config)", () => {
    const result = projectHarnessConfig({
      ...referenceInput(),
      capabilitySurface: {
        ...referenceInput().capabilitySurface,
        guardrailConfigured: true,
      },
    });
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "harness_unsupported",
        capability: "bedrock_guardrail",
      }),
    });
  });

  it("excludes a baseline sandbox template as trial scope instead of rejecting", () => {
    const input = referenceInput();
    input.capabilitySurface = {
      ...input.capabilitySurface,
      sandboxConfigured: true,
    };
    const result = projectHarnessConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.evidence.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "sandbox_execute_code",
          disposition: "not_projected_trial_scope",
        }),
      ]),
    );
  });

  it.each([
    [{ piExtensionCount: 2 }, "harness_unsupported", "pi_extensions"],
    [
      { browserAutomationEnabled: true },
      "adapter_unimplemented",
      "browser_automation",
    ],
    [{ attachmentCount: 1 }, "adapter_unimplemented", "message_attachments"],
  ] as const)("rejects %o as %s (%s)", (surfacePatch, kind, capability) => {
    const input = referenceInput();
    const result = projectHarnessConfig({
      ...input,
      capabilitySurface: { ...input.capabilitySurface, ...surfacePatch },
    });
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({ kind, capability }),
    });
  });

  it("rejects when the manifest fingerprint is absent (R9 evidence contract)", () => {
    const result = projectHarnessConfig({
      ...referenceInput(),
      manifestFingerprint: null,
    });
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "evidence_missing",
        capability: "capabilities_manifest_fingerprint",
      }),
    });
  });

  it("rejects a missing model instead of substituting a default", () => {
    const result = projectHarnessConfig({
      ...referenceInput(),
      modelId: null,
    });
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "invalid_input",
        capability: "model",
      }),
    });
  });

  it("rejects non-Bedrock model providers", () => {
    const result = projectHarnessConfig({
      ...referenceInput(),
      modelProvider: "openai",
    });
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "harness_unsupported",
        capability: "model_provider:openai",
      }),
    });
  });

  it("rejects plain-http MCP endpoints", () => {
    const input = referenceInput();
    input.mcpConfigs[0] = {
      ...input.mcpConfigs[0],
      url: "http://internal.example/mcp",
    };
    const result = projectHarnessConfig(input);
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "harness_unsupported",
        capability: "mcp:lastmile-data",
      }),
    });
  });

  it("rejects MCP auth shapes the adapter cannot express", () => {
    const input = referenceInput();
    input.mcpConfigs[0] = {
      ...input.mcpConfigs[0],
      auth: { type: "oauth_dance", clientId: "x" } as never,
    };
    const result = projectHarnessConfig(input);
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "adapter_unimplemented",
        capability: "mcp_auth:lastmile-data",
      }),
    });
  });

  it("rejects content skills that carry credential-bearing env overrides", () => {
    const input = referenceInput();
    input.skills.push({
      skillId: "custom-skill",
      s3Key: "tenants/tei/agents/thinkwork-agent/skills/custom-skill",
      envOverrides: { MY_SERVICE_TOKEN: "shhh" },
    });
    const result = projectHarnessConfig(input);
    expect(result).toEqual({
      ok: false,
      rejection: expect.objectContaining({
        kind: "adapter_unimplemented",
        capability: "skill_env:custom-skill",
      }),
    });
  });
});

describe("projectHarnessConfig — edges", () => {
  it("omits @builtin when no skills materialize", () => {
    const input = referenceInput();
    input.skills = input.skills.filter(
      (skill) => skill.skillId !== "document-composer",
    );
    const result = projectHarnessConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.skillMaterializations).toEqual([]);
    expect(result.config.allowedTools).not.toContain("@builtin");
  });

  it("widens to @server/* when a connector has no operation narrowing", () => {
    const input = referenceInput();
    input.mcpConfigs[0] = {
      ...input.mcpConfigs[0],
      tools: undefined,
      availableTools: undefined,
    };
    const result = projectHarnessConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.allowedTools).toContain("@lastmile-data/*");
  });

  it("merges bearer + static headers auth", () => {
    const input = referenceInput();
    input.mcpConfigs[0] = {
      ...input.mcpConfigs[0],
      auth: {
        type: "bearer",
        token: "tok",
        headers: { "x-tenant": "tei" },
      },
    };
    const result = projectHarnessConfig(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mcpTool = result.config.tools.find((t) => t.type === "mcp");
    expect(mcpTool).toMatchObject({
      remoteMcp: {
        headers: { Authorization: "Bearer tok", "x-tenant": "tei" },
      },
    });
  });

  it("applies default limits and honors overrides", () => {
    const withDefaults = projectHarnessConfig(referenceInput());
    expect(withDefaults.ok).toBe(true);
    if (!withDefaults.ok) return;
    expect(withDefaults.config.maxIterations).toBe(50);
    expect(withDefaults.config.timeoutSeconds).toBe(900);
    expect(withDefaults.config.maxTokens).toBeUndefined();

    const withLimits = projectHarnessConfig({
      ...referenceInput(),
      limits: { maxIterations: 25, timeoutSeconds: 600, maxTokens: 8192 },
    });
    expect(withLimits.ok).toBe(true);
    if (!withLimits.ok) return;
    expect(withLimits.config.maxIterations).toBe(25);
    expect(withLimits.config.timeoutSeconds).toBe(600);
    expect(withLimits.config.maxTokens).toBe(8192);
  });
});

describe("deriveHarnessName", () => {
  it("produces a CreateHarness-legal name from slug + ids", () => {
    expect(deriveHarnessName("thinkwork-agent", "t", "a")).toMatch(
      /^tw_thinkwork_agent_[0-9a-f]{10}$/,
    );
    expect(deriveHarnessName("--weird!!slug--", "t", "a")).toMatch(
      /^tw_[A-Za-z0-9_]+_[0-9a-f]{10}$/,
    );
    expect(deriveHarnessName("", "t", "a")).toMatch(/^tw_agent_[0-9a-f]{10}$/);
  });
});
