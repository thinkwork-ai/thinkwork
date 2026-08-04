import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── S3 mock (scriptable send) ──────────────────────────────────────────────
// U11: the workspace agent-folder index (list/get) is exercised against a
// scriptable S3 facade; the retired agent_profiles projections are gone —
// this file no longer mocks a database beyond the tenant lookup.

const { s3State } = vi.hoisted(() => ({
  s3State: {
    objects: new Map<string, string>(),
    lastModified: new Map<string, Date>(),
    sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class FakeCommand {
    constructor(
      public kind: string,
      public input: Record<string, unknown>,
    ) {}
  }
  return {
    S3Client: class {
      async send(command: InstanceType<typeof FakeCommand>) {
        s3State.sent.push({ kind: command.kind, input: command.input });
        const key = command.input.Key as string | undefined;
        if (command.kind === "get") {
          if (!key || !s3State.objects.has(key)) {
            const err = new Error("NoSuchKey") as Error & { name: string };
            err.name = "NoSuchKey";
            throw err;
          }
          return {
            Body: {
              transformToString: async () => s3State.objects.get(key),
            },
          };
        }
        if (command.kind === "list") {
          const prefix = command.input.Prefix as string;
          return {
            Contents: [...s3State.objects.keys()]
              .filter((k) => k.startsWith(prefix))
              .map((k) => ({
                Key: k,
                LastModified: s3State.lastModified.get(k),
              })),
            IsTruncated: false,
          };
        }
        return {};
      }
    },
    GetObjectCommand: class extends FakeCommand {
      constructor(input: Record<string, unknown>) {
        super("get", input);
      }
    },
    ListObjectsV2Command: class extends FakeCommand {
      constructor(input: Record<string, unknown>) {
        super("list", input);
      }
    },
    PutObjectCommand: class extends FakeCommand {
      constructor(input: Record<string, unknown>) {
        super("put", input);
      }
    },
    DeleteObjectCommand: class extends FakeCommand {
      constructor(input: Record<string, unknown>) {
        super("delete", input);
      }
    },
  };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) => (key === "WORKSPACE_BUCKET" ? "bucket" : ""),
}));

vi.mock("./agents/tenant-platform-agent.js", () => ({
  resolveTenantPlatformAgent: vi.fn(async () => ({
    slug: "think",
    workspace_folder_name: "think",
  })),
}));

vi.mock("../graphql/utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ slug: "acme" }]),
      }),
    }),
  },
  eq: () => ({}),
  tenants: { id: {}, slug: {} },
}));

import {
  agentProfileSlugFromWorkspacePath,
  getAgentFolderProfileForTenant,
  isAgentProfileWorkspacePath,
  isSpaceAgentProfileWorkspacePath,
  listAgentFolderProfilesForTenant,
  parseAgentProfileFile,
  serializeAgentProfileFile,
  spaceAgentProfileSlugFromWorkspacePath,
} from "./agent-profile-workspace-files.js";

const TENANT_ID = "tenant-1";
const PREFIX = "tenants/acme/agents/think/";

beforeEach(() => {
  s3State.objects.clear();
  s3State.lastModified.clear();
  s3State.sent.length = 0;
});

describe("agent profile workspace files", () => {
  it("recognizes canonical Agent Profile markdown files", () => {
    expect(isAgentProfileWorkspacePath("agents/research.md")).toBe(true);
    expect(isAgentProfileWorkspacePath("/agents/research.md")).toBe(true);
    expect(isAgentProfileWorkspacePath("agents/research/CONTEXT.md")).toBe(
      false,
    );
    expect(agentProfileSlugFromWorkspacePath("agents/coding.md")).toBe(
      "coding",
    );
  });

  it("round-trips structured profile fields through markdown frontmatter", () => {
    const content = serializeAgentProfileFile({
      slug: "research",
      name: "Research",
      description: "Finds and synthesizes sources.",
      routingGuidance: "Use for source-backed research.",
      instructions: "Return concise cited findings.",
      modelId: "claude-haiku-4-5",
      enabled: true,
      builtInKey: "research",
      toolPolicy: {
        builtInTools: ["web-search", "web-extract"],
        mcpServers: ["twenty-crm"],
      },
      skillPolicy: { skillSlugs: ["source-review"] },
      executionControls: {
        foreground: true,
        clarify: false,
        maxSubagentDepth: 0,
        maxRuntimeMs: 120000,
        maxTokens: 4096,
        thinking: "minimal",
        reviewGate: true,
        maxReviewLoops: 2,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 2,
          maxReviewLoops: 2,
          reviewGate: true,
          externalReviewerPolicy: "profile_required",
          failBehavior: "best_effort_with_warning",
        },
      },
      spaceIds: ["space-research"],
    });

    const parsed = parseAgentProfileFile({
      path: "agents/research.md",
      content,
    });

    expect(parsed).toMatchObject({
      slug: "research",
      name: "Research",
      description: "Finds and synthesizes sources.",
      routingGuidance: "Use for source-backed research.",
      instructions: "Return concise cited findings.",
      modelId: "claude-haiku-4-5",
      enabled: true,
      builtInKey: "research",
      toolPolicy: {
        builtInTools: ["web-search", "web-extract"],
        mcpServers: ["twenty-crm"],
      },
      skillPolicy: { skillSlugs: ["source-review"] },
      executionControls: {
        foreground: true,
        clarify: false,
        maxSubagentDepth: 0,
        maxRuntimeMs: 120000,
        maxTokens: 4096,
        thinking: "minimal",
        reviewGate: true,
        maxReviewLoops: 2,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 2,
          maxReviewLoops: 2,
          reviewGate: true,
          externalReviewerPolicy: "profile_required",
          failBehavior: "best_effort_with_warning",
        },
      },
      spaceRefs: ["space-research"],
    });
  });

  it("recognizes space-source Agent Profile paths (source-relative form)", () => {
    expect(isSpaceAgentProfileWorkspacePath("agents/research.md")).toBe(true);
    expect(isSpaceAgentProfileWorkspacePath("/agents/research.md")).toBe(true);
    expect(isSpaceAgentProfileWorkspacePath("SPACE.md")).toBe(false);
    expect(isSpaceAgentProfileWorkspacePath("docs/agents/research.md")).toBe(
      false,
    );
    expect(isSpaceAgentProfileWorkspacePath("agents/research/CONTEXT.md")).toBe(
      false,
    );
    expect(spaceAgentProfileSlugFromWorkspacePath("agents/coding.md")).toBe(
      "coding",
    );
  });
});

describe("workspace agent-folder index (subagent-folders U11)", () => {
  const INSTRUCTIONS = `---\ndescription: Helps with research.\nmodel: m-1\nbuiltInTools:\n  - web-search\n---\n\nDo the research.\n`;

  it("lists agents/<slug>/INSTRUCTIONS.md folder profiles", async () => {
    s3State.objects.set(
      `${PREFIX}agents/research/INSTRUCTIONS.md`,
      INSTRUCTIONS,
    );
    s3State.objects.set(
      `${PREFIX}agents/coding/INSTRUCTIONS.md`,
      `---\ndescription: Codes.\nenabled: false\n---\n\nCode.\n`,
    );
    // Non-profile keys under agents/ are ignored.
    s3State.objects.set(
      `${PREFIX}agents/research/skills/x/.assignment.json`,
      "{}",
    );
    s3State.objects.set(`${PREFIX}agents/legacy.md`, "---\nmodel: m\n---\n");

    const profiles = await listAgentFolderProfilesForTenant(TENANT_ID);
    expect(profiles?.map((p) => p.slug)).toEqual(["coding", "research"]);
    const research = profiles?.find((p) => p.slug === "research");
    expect(research?.config).toMatchObject({
      description: "Helps with research.",
      model: "m-1",
      enabled: true,
      builtInTools: ["web-search"],
      instructions: "Do the research.",
    });
    expect(profiles?.find((p) => p.slug === "coding")?.config.enabled).toBe(
      false,
    );
  });

  it("skips strict-parse failures instead of failing the listing", async () => {
    s3State.objects.set(
      `${PREFIX}agents/bad/INSTRUCTIONS.md`,
      `---\nmodelId: legacy-alias\n---\n\nBody.\n`,
    );
    s3State.objects.set(`${PREFIX}agents/good/INSTRUCTIONS.md`, INSTRUCTIONS);
    const profiles = await listAgentFolderProfilesForTenant(TENANT_ID);
    expect(profiles?.map((p) => p.slug)).toEqual(["good"]);
  });

  it("applies the .assignment.json sidecar overlay (disable wins)", async () => {
    s3State.objects.set(
      `${PREFIX}agents/research/INSTRUCTIONS.md`,
      INSTRUCTIONS,
    );
    s3State.objects.set(
      `${PREFIX}agents/research/.assignment.json`,
      JSON.stringify({ enabled: false }),
    );
    const profile = await getAgentFolderProfileForTenant(TENANT_ID, "research");
    expect(profile?.config.enabled).toBe(false);
  });

  it("returns null for an absent folder profile", async () => {
    expect(await getAgentFolderProfileForTenant(TENANT_ID, "ghost")).toBeNull();
  });
});

describe("serializeAgentProfileFolderForm (subagent-folders U12)", () => {
  it("emits strict folder form: description absorbs routingGuidance, no legacy fields", async () => {
    const { serializeAgentProfileFolderForm } = await import(
      "./agent-profile-workspace-files.js"
    );
    const { parseAgentFolderInstructions } = await import(
      "./agent-folder-format.js"
    );
    const content = serializeAgentProfileFolderForm({
      slug: "helper",
      name: "Helper",
      description: "Helps.",
      routingGuidance: "Use often.",
      instructions: "Help with things.",
      modelId: "anthropic/claude-sonnet-5",
      enabled: true,
      toolPolicy: {
        builtInTools: ["web-search"],
        mcpServers: ["postgres-dev"],
      },
      executionControls: {
        foreground: true,
        maxSubagentDepth: 0,
        maxTokens: 2000,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 1,
          maxReviewLoops: 1,
          reviewGate: true,
          externalReviewerPolicy: "explicit",
          failBehavior: "return_blocker",
        },
      },
    });
    const parsed = parseAgentFolderInstructions(
      content,
      "agents/helper/INSTRUCTIONS.md",
    );
    if (!parsed.valid) {
      throw new Error(parsed.errors.map((e) => e.message).join("; "));
    }
    expect(parsed.parsed.description).toBe("Helps. Use often.");
    expect(parsed.parsed.model).toBe("anthropic/claude-sonnet-5");
    expect(parsed.parsed.builtInTools).toEqual(["web-search"]);
    expect(parsed.parsed.execution.maxTokens).toBe(2000);
    expect(parsed.parsed.instructions).toBe("Help with things.");
    // Legacy-only keys never leak into the strict form.
    expect(content).not.toContain("mcpServers");
    expect(content).not.toContain("maxSubagentDepth");
    expect(content).not.toContain("routingGuidance");
  });

  it("falls back to the display name when description and routingGuidance are absent", async () => {
    const { serializeAgentProfileFolderForm } = await import(
      "./agent-profile-workspace-files.js"
    );
    const content = serializeAgentProfileFolderForm({
      slug: "helper",
      name: "Helper",
      instructions: "Body.",
      modelId: "m",
    });
    expect(content).toContain("description: Helper");
  });
});
