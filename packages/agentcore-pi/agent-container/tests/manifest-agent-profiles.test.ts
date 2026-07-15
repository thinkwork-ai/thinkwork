import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  agentProfilesFromManifest,
  diffProfileSources,
} from "../src/runtime/manifest-agent-profiles.js";
import type { CapabilitiesManifestFile } from "../src/runtime/capabilities-json.js";
import type { AgentProfileConfig } from "../src/agent-profile-adapter.js";

const INSTRUCTIONS = `---
description: Deep research specialist
builtInTools:
  - web-search
---

Research thoroughly. Cite sources.
`;

function md5(content: string): string {
  return createHash("md5").update(content, "utf8").digest("hex");
}

function manifest(
  entries: Array<Record<string, unknown>>,
): CapabilitiesManifestFile {
  return {
    version: 1,
    fingerprint: "f".repeat(64),
    agent: { tenant_id: "t1", agent_slug: "marco" },
    active: entries as never,
    withheld: [],
    signature: null,
  };
}

function agentEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "researcher",
    slug: "researcher",
    class: "agent",
    description: "Deep research specialist",
    builtInTools: ["web-search"],
    execution: {
      foreground: true,
      clarify: false,
      maxTokens: 4000,
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
    grants: [
      { class: "skill", slug: "crm" },
      { class: "connector", slug: "postgres-dev", operations: ["query"] },
    ],
    instructionsEtag: md5(INSTRUCTIONS),
    ...overrides,
  };
}

describe("agentProfilesFromManifest", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "manifest-profiles-"));
    await mkdir(path.join(root, "agents", "researcher"), { recursive: true });
    await writeFile(
      path.join(root, "agents", "researcher", "INSTRUCTIONS.md"),
      INSTRUCTIONS,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("maps an agent entry + synced instructions to an AgentProfileConfig (R15)", async () => {
    const result = await agentProfilesFromManifest({
      manifest: manifest([agentEntry()]),
      workspaceDir: root,
    });
    expect(result.skipped).toEqual([]);
    const profile = result.profiles[0]!;
    expect(profile.slug).toBe("researcher");
    expect(profile.name).toBe("Researcher");
    // Prose body only — frontmatter is compiled state, never re-parsed.
    expect(profile.instructions).toBe("Research thoroughly. Cite sources.");
    expect(profile.toolPolicy?.builtInTools).toEqual(["web-search"]);
    expect(profile.toolPolicy?.skills).toEqual(["crm"]);
    expect(profile.toolPolicy?.mcpServers).toEqual([
      { serverName: "postgres-dev", toolWhitelist: ["query"] },
    ]);
    expect(profile.executionControls?.maxTokens).toBe(4000);
    expect(profile.executionControls?.loopPolicy?.mode).toBe("closed");
  });

  it("skips loudly when the synced folder is missing (no dead turn)", async () => {
    const result = await agentProfilesFromManifest({
      manifest: manifest([agentEntry({ slug: "ghost", name: "ghost" })]),
      workspaceDir: root,
    });
    expect(result.profiles).toEqual([]);
    expect(result.skipped).toMatchObject([
      { slug: "ghost", reason: "missing_instructions" },
    ]);
  });

  it("covers AE5/KTD-10: an etag mismatch is a loud per-profile skip, never unpinned execution", async () => {
    await writeFile(
      path.join(root, "agents", "researcher", "INSTRUCTIONS.md"),
      INSTRUCTIONS.replace("Cite", "Never cite"),
    );
    const result = await agentProfilesFromManifest({
      manifest: manifest([agentEntry()]),
      workspaceDir: root,
    });
    expect(result.profiles).toEqual([]);
    expect(result.skipped).toMatchObject([
      { slug: "researcher", reason: "instructions_etag_mismatch" },
    ]);
  });

  it("carries withheld child grants for the child prompt (THINK-229 posture)", async () => {
    const result = await agentProfilesFromManifest({
      manifest: manifest([
        agentEntry({
          withheldGrants: [
            {
              class: "connector",
              slug: "salesforce",
              reason: "missing_connection",
              detail: "root connection 'salesforce' is not active",
            },
          ],
        }),
      ]),
      workspaceDir: root,
    });
    expect(result.withheldGrants).toMatchObject([
      {
        profileSlug: "researcher",
        class: "connector",
        slug: "salesforce",
        reason: "missing_connection",
      },
    ]);
  });
});

describe("diffProfileSources", () => {
  const base: AgentProfileConfig = {
    id: "db-1",
    slug: "researcher",
    name: "Research",
    modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    instructions: "Research thoroughly. Cite sources.",
    toolPolicy: {
      defaultTools: [],
      builtInTools: ["web-search"],
      disabledDefaultTools: [],
      skills: ["crm"],
      mcpServers: [{ serverName: "postgres-dev", toolWhitelist: ["query"] }],
    },
  } as AgentProfileConfig;

  const manifestSide: AgentProfileConfig = {
    ...base,
    id: "manifest:researcher",
    name: "Researcher",
    modelId: "",
  };

  it("reports zero divergence when the sources agree (model absent = inherit)", () => {
    expect(
      diffProfileSources({
        payloadProfiles: [base],
        manifestProfiles: [manifestSide],
      }),
    ).toEqual([]);
  });

  it("names divergent fields per slug", () => {
    const divergences = diffProfileSources({
      payloadProfiles: [base],
      manifestProfiles: [
        {
          ...manifestSide,
          instructions: "Different prose.",
          toolPolicy: {
            ...manifestSide.toolPolicy!,
            builtInTools: [],
          },
        },
      ],
    });
    expect(divergences).toEqual([
      {
        slug: "researcher",
        fields: expect.arrayContaining(["instructions", "builtInTools"]),
      },
    ]);
  });

  it("reports profiles present on only one side", () => {
    expect(
      diffProfileSources({
        payloadProfiles: [base],
        manifestProfiles: [],
      }),
    ).toEqual([{ slug: "researcher", fields: ["missing_in_manifest"] }]);
    expect(
      diffProfileSources({
        payloadProfiles: [],
        manifestProfiles: [manifestSide],
      }),
    ).toEqual([{ slug: "researcher", fields: ["missing_in_payload"] }]);
  });
});
