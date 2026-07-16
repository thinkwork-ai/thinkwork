import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bindingScanKey,
  CAPABILITY_COMPILE_REVISION,
  compileCapabilitiesManifest,
  computeCapabilityInputSignature,
  parseCapabilitiesManifest,
  scopeSpecificity,
  selectMostSpecificScope,
  type CapabilityFolderInput,
  type CapabilityManifestEntry,
  type RegistryTrustInput,
} from "./manifest-compile.js";
import { legacyPrincipalRemediation } from "./definition-schemas.js";
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  definitionContentSha,
  signCapabilitySidecar,
} from "./sidecar-signing.js";
import {
  computeFolderAttestation,
  type CapabilityApprovalRow,
} from "./approval-registry.js";
import { filesEtagSignature } from "./script-trust.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = capabilitySignerFromKey(privateKey);
const verifier = capabilityVerifierFromKey(publicKey);

const agent = { tenantId: "tenant-1", agentSlug: "ops" };

const connectionMd = `---
name: firecrawl
description: Firecrawl API.
type: api
url: https://api.firecrawl.dev
operations:
  - scrape
  - crawl
---
Firecrawl connection.
`;

const bindingMd = (name: string, operation = "scrape") => `---
name: ${name}
description: Scrape via firecrawl.
kind: binding
connection: firecrawl
operation: ${operation}
---
Binding.
`;

function signedFolder(input: {
  klass: "connection" | "tool";
  slug: string;
  definition: string;
  sidecarExtras?: Record<string, unknown>;
  definitionForSigning?: string;
}): CapabilityFolderInput {
  const sidecarBase = {
    slug: input.slug,
    class: input.klass,
    updated_at: "2026-07-05T00:00:00.000Z",
    ...(input.sidecarExtras ?? {}),
  };
  const { signed_content_sha, signature } = signCapabilitySidecar({
    signer,
    sidecar: sidecarBase,
    definitionBytes: input.definitionForSigning ?? input.definition,
    signedBy: "operator:u1",
  });
  return {
    class: input.klass,
    slug: input.slug,
    definitionPath: `${input.klass}s/${input.slug}/${
      input.klass === "connection" ? "CONNECTION.md" : "TOOL.md"
    }`,
    definitionRaw: input.definition,
    sidecarRaw: JSON.stringify({
      ...sidecarBase,
      signed_content_sha,
      signature,
    }),
  };
}

function compile(
  folders: CapabilityFolderInput[],
  extras?: {
    skills?: Array<{ slug: string; enabled: boolean; active: boolean }>;
    extensionToolNames?: string[];
  },
) {
  return compileCapabilitiesManifest({
    agent,
    folders,
    skills: extras?.skills ?? [],
    extensionToolNames: extras?.extensionToolNames,
    verifier,
    signer,
    inputSignature: "sig-1",
    generatedAt: "2026-07-05T00:00:00.000Z",
  });
}

describe("compileCapabilitiesManifest", () => {
  it("compiles all five capability classes into active entries", () => {
    const { manifest } = compile(
      [
        signedFolder({
          klass: "connection",
          slug: "firecrawl",
          definition: connectionMd,
        }),
        signedFolder({
          klass: "tool",
          slug: "firecrawl-scrape",
          definition: bindingMd("firecrawl-scrape"),
        }),
        signedFolder({
          klass: "tool",
          slug: "send-email",
          definition: `---\nname: send-email\ndescription: d\nkind: platform\nplatform_tool: send_email\n---\n`,
        }),
        signedFolder({
          klass: "tool",
          slug: "brain-search",
          definition: `---\nname: brain-search\ndescription: d\nkind: extension\nextension: brain\ntool: brain_search\n---\n`,
        }),
      ],
      { skills: [{ slug: "sales-prep", enabled: true, active: true }] },
    );
    const classes = new Set(manifest.active.map((entry) => entry.class));
    expect(classes).toEqual(
      new Set(["builtin", "skill", "connection", "tool"]),
    );
    const kinds = manifest.active
      .filter((entry) => entry.class === "tool")
      .map((entry) => entry.kind)
      .sort();
    expect(kinds).toEqual(["binding", "extension", "platform"]);
    expect(manifest.withheld).toEqual([]);
  });

  it("AE1: unsigned folder is excluded from active, present in withheld", () => {
    const { manifest } = compile([
      {
        class: "tool",
        slug: "exfil",
        definitionPath: "tools/exfil/TOOL.md",
        definitionRaw: `---\nname: exfil\ndescription: d\nkind: script\nentry: run.sh\n---\n`,
        sidecarRaw: null,
      },
    ]);
    expect(manifest.active.some((entry) => entry.slug === "exfil")).toBe(false);
    expect(manifest.withheld).toEqual([
      { slug: "exfil", class: "tool", reason: "unsigned" },
    ]);
  });

  it("AE2: collision with a builtin fails the entry and retains the builtin", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "connection",
        slug: "web",
        definition: `---\nname: web\ndescription: d\ntype: api\noperations: [bash]\n---\n`,
      }),
      signedFolder({
        klass: "tool",
        slug: "bash",
        definition: `---\nname: bash\ndescription: d\nkind: binding\nconnection: web\noperation: bash\n---\n`,
      }),
    ]);
    expect(manifest.active.filter((entry) => entry.name === "bash")).toEqual([
      { name: "bash", slug: "bash", class: "builtin" },
    ]);
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "bash",
        class: "tool",
        reason: "collision",
        detail: expect.stringContaining("builtin"),
      }),
    ]);
  });

  it("AE3: declared approval gate withholds the entry (v1 blunt enforcement)", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "tool",
        slug: "send-email",
        definition: `---\nname: send-email\ndescription: d\nkind: platform\nplatform_tool: send_email\n---\n`,
        sidecarExtras: { approval: "once" },
      }),
    ]);
    expect(manifest.active.some((e) => e.slug === "send-email")).toBe(false);
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "send-email",
        reason: "approval_gated",
      }),
    ]);
  });

  it("AE8: definition edited after signing is withheld as definition_drift", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd + "\nhand-edited in S3 after approval\n",
        definitionForSigning: connectionMd,
      }),
    ]);
    expect(manifest.withheld).toEqual([
      { slug: "firecrawl", class: "connection", reason: "definition_drift" },
    ]);
  });

  it("withholds disabled entries and bindings over inactive connections", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd,
        sidecarExtras: { enabled: false },
      }),
      signedFolder({
        klass: "tool",
        slug: "firecrawl-scrape",
        definition: bindingMd("firecrawl-scrape"),
      }),
    ]);
    expect(manifest.withheld).toEqual([
      { slug: "firecrawl", class: "connection", reason: "disabled" },
      expect.objectContaining({
        slug: "firecrawl-scrape",
        reason: "missing_connection",
      }),
    ]);
  });

  it("enforces the connection's permitted operations on bindings", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd,
        sidecarExtras: { permissions: { operations: ["scrape"] } },
      }),
      signedFolder({
        klass: "tool",
        slug: "firecrawl-crawl",
        definition: bindingMd("firecrawl-crawl", "crawl"),
      }),
    ]);
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "firecrawl-crawl",
        reason: "operation_not_permitted",
      }),
    ]);
  });

  it("script kind without a current passed trust report is withheld (R8)", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "tool",
        slug: "cruncher",
        definition: `---\nname: cruncher\ndescription: d\nkind: script\nentry: run.sh\n---\n`,
      }),
    ]);
    expect(manifest.withheld).toEqual([
      expect.objectContaining({ slug: "cruncher", reason: "trust_gate" }),
    ]);
  });

  it("tampered sidecar payload is withheld as invalid_signature", () => {
    const folder = signedFolder({
      klass: "connection",
      slug: "firecrawl",
      definition: connectionMd,
    });
    const sidecar = JSON.parse(folder.sidecarRaw!) as Record<string, unknown>;
    sidecar.permissions = { operations: ["scrape", "crawl"] };
    const { manifest } = compile([
      { ...folder, sidecarRaw: JSON.stringify(sidecar) },
    ]);
    expect(manifest.withheld).toEqual([
      { slug: "firecrawl", class: "connection", reason: "invalid_signature" },
    ]);
  });

  it("null verifier fails closed: signed sidecars withheld as unsigned", () => {
    const { manifest } = compileCapabilitiesManifest({
      agent,
      folders: [
        signedFolder({
          klass: "connection",
          slug: "firecrawl",
          definition: connectionMd,
        }),
      ],
      skills: [],
      verifier: null,
      signer,
      inputSignature: "sig-1",
      generatedAt: "2026-07-05T00:00:00.000Z",
    });
    expect(manifest.active.some((e) => e.class === "connection")).toBe(false);
    expect(manifest.withheld[0]).toMatchObject({ reason: "unsigned" });
  });

  it("content address changes iff the meaningful body changes", () => {
    const folders = [
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd,
      }),
    ];
    const a = compile(folders).manifest;
    const b = compileCapabilitiesManifest({
      agent,
      folders,
      skills: [],
      verifier,
      signer,
      inputSignature: "different-input-sig",
      generatedAt: "2027-01-01T00:00:00.000Z",
    }).manifest;
    // Same body, different metadata → same content address.
    expect(b.fingerprint).toBe(a.fingerprint);
    const c = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd.replace(
          "url: https://api.firecrawl.dev",
          "url: https://api2.firecrawl.dev",
        ),
      }),
    ]).manifest;
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it("signs the manifest envelope U6 verifies; tampered bytes fail (U2)", () => {
    const { manifest } = compile([]);
    expect(manifest.signature).not.toBeNull();
    const { fingerprint, input_signature, generated_at, signature, ...body } =
      manifest;
    expect(verifier.verifyPayload(body, signature)).toBe(true);
    const tampered = {
      ...body,
      active: body.active.filter((entry) => entry.name !== "bash"),
    };
    expect(verifier.verifyPayload(tampered, signature)).toBe(false);
    expect(signature?.signed_by).toBe("render");
  });

  it("legacy folder without capability_ref compiles to the pre-U1b fingerprint (regression)", () => {
    const { manifest } = compile(
      [
        signedFolder({
          klass: "connection",
          slug: "firecrawl",
          definition: connectionMd,
        }),
        signedFolder({
          klass: "tool",
          slug: "firecrawl-scrape",
          definition: bindingMd("firecrawl-scrape"),
        }),
      ],
      { skills: [{ slug: "sales-prep", enabled: true, active: true }] },
    );
    // Byte-identity proof for THINK-280 U1b shadow fields: this hash was
    // computed with the compiler AS OF BEFORE capability_ref/twcap
    // support landed, over exactly these fixtures. Folders that do not
    // declare the new fields must keep producing it. (The manifest body
    // also covers BUILTIN_TOOL_NAMES — if the builtin list changes, this
    // pin moves for that unrelated reason and must be recomputed.)
    expect(manifest.fingerprint).toBe(
      "41d6388c712928254dbe73829b17c01c5690b4224186ccb9ee83647914831f16",
    );
    const connection = manifest.active.find((e) => e.class === "connection")!;
    expect("twcap" in connection).toBe(false);
    expect("descriptor_fingerprint" in connection).toBe(false);
  });

  it("shadow twcap identity round-trips parse -> compile -> parseCapabilitiesManifest", () => {
    const twcap =
      "twcap://acme/connection/firecrawl/versions/1/operations/scrape" +
      `?contract=sha256:${"a".repeat(64)}`;
    const descriptorFingerprint = "b".repeat(64);
    const withRef = connectionMd.replace(
      "operations:",
      [
        "capability_ref:",
        `  twcap: "${twcap}"`,
        `  descriptor_fingerprint: "${descriptorFingerprint}"`,
        "operations:",
      ].join("\n"),
    );
    const legacy = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd,
      }),
    ]);
    const { manifest, json } = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: withRef,
      }),
    ]);
    const entry = manifest.active.find((e) => e.class === "connection")!;
    expect(entry.twcap).toBe(twcap);
    expect(entry.descriptor_fingerprint).toBe(descriptorFingerprint);
    // Entries carrying the new fields MAY move the fingerprint — only
    // unchanged-legacy-folder stability is guaranteed.
    expect(manifest.fingerprint).not.toBe(legacy.manifest.fingerprint);
    const reparsed = parseCapabilitiesManifest(json);
    const roundTripped = reparsed?.active.find((e) => e.class === "connection");
    expect(roundTripped?.twcap).toBe(twcap);
    expect(roundTripped?.descriptor_fingerprint).toBe(descriptorFingerprint);
  });

  it("legacy principalType flows through untranslated; remediation is the only bridge", () => {
    const { manifest } = compile([
      signedFolder({
        klass: "connection",
        slug: "firecrawl",
        definition: connectionMd.replace(
          "type: api",
          "type: api\nprincipal_type: user",
        ),
      }),
    ]);
    const entry = manifest.active.find((e) => e.class === "connection")!;
    expect(entry.principalType).toBe("user");
    expect(["requester", "agent_owner", "service"]).not.toContain(
      entry.principalType,
    );
    expect(legacyPrincipalRemediation(entry.principalType as "user")).toEqual({
      legacy: "user",
      remediation: "explicit-principal-migration-required",
    });
  });

  it("parseCapabilitiesManifest round-trips and rejects malformed input", () => {
    const { manifest, json } = compile([]);
    expect(parseCapabilitiesManifest(json)?.fingerprint).toBe(
      manifest.fingerprint,
    );
    expect(parseCapabilitiesManifest(null)).toBeNull();
    expect(parseCapabilitiesManifest("{nope")).toBeNull();
    expect(parseCapabilitiesManifest('{"version": 99}')).toBeNull();
  });
});

describe("computeCapabilityInputSignature", () => {
  const objects = [
    { key: "a/connections/x/CONNECTION.md", etag: "e1" },
    { key: "a/connections/x/.assignment.json", etag: "e2" },
  ];
  const skills = [{ slug: "s", enabled: true, active: true }];

  it("is stable across ordering and changes on etag drift", () => {
    const a = computeCapabilityInputSignature({
      capabilityObjects: objects,
      skills,
    });
    const b = computeCapabilityInputSignature({
      capabilityObjects: [...objects].reverse(),
      skills,
    });
    expect(a).toBe(b);
    const c = computeCapabilityInputSignature({
      capabilityObjects: [objects[0]!, { ...objects[1]!, etag: "e3" }],
      skills,
    });
    expect(c).not.toBe(a);
  });

  it("changes when skill state changes", () => {
    const a = computeCapabilityInputSignature({
      capabilityObjects: objects,
      skills,
    });
    const b = computeCapabilityInputSignature({
      capabilityObjects: objects,
      skills: [{ slug: "s", enabled: false, active: true }],
    });
    expect(b).not.toBe(a);
  });
});

describe("agent folder admission (subagent-folders U4)", () => {
  const instructionsMd = `---
description: Deep research specialist
model: anthropic/claude-sonnet-5
---

Research thoroughly. Cite sources.
`;

  function agentFolder(input: {
    slug?: string;
    definition?: string;
    definitionEtag?: string | null;
    sidecar?: "none" | "unsigned" | "signed";
    sidecarExtras?: Record<string, unknown>;
    definitionForSigning?: string;
    files?: Array<{ path: string; etag?: string | null }>;
  }): CapabilityFolderInput {
    const slug = input.slug ?? "researcher";
    const definition = input.definition ?? instructionsMd;
    const sidecarMode = input.sidecar ?? "none";
    let sidecarRaw: string | null = null;
    if (sidecarMode !== "none") {
      const base = {
        slug,
        class: "agent",
        updated_at: "2026-07-05T00:00:00.000Z",
        ...(input.sidecarExtras ?? {}),
      };
      if (sidecarMode === "unsigned") {
        sidecarRaw = JSON.stringify(base);
      } else {
        const { signed_content_sha, signature } = signCapabilitySidecar({
          signer,
          sidecar: base,
          definitionBytes: input.definitionForSigning ?? definition,
          signedBy: "operator:u1",
        });
        sidecarRaw = JSON.stringify({ ...base, signed_content_sha, signature });
      }
    }
    return {
      class: "agent",
      slug,
      definitionPath: `agents/${slug}/INSTRUCTIONS.md`,
      definitionRaw: definition,
      definitionEtag: input.definitionEtag ?? "etag-1",
      sidecarRaw,
      files: input.files ?? [{ path: "INSTRUCTIONS.md", etag: "etag-1" }],
    };
  }

  it("admits a sidecar-less folder as an active agent entry (R7 skills convention)", () => {
    const { manifest } = compile([agentFolder({})]);
    const entry = manifest.active.find((e) => e.class === "agent");
    expect(entry).toMatchObject({
      name: "researcher",
      slug: "researcher",
      class: "agent",
      description: "Deep research specialist",
      model: "anthropic/claude-sonnet-5",
      instructionsEtag: "etag-1",
    });
    expect(entry?.execution).toMatchObject({ foreground: true });
    expect(entry?.execution).not.toHaveProperty("maxSubagentDepth");
    expect(manifest.withheld).toEqual([]);
  });

  it("withholds a folder whose INSTRUCTIONS.md lacks a description (R3)", () => {
    const { manifest } = compile([
      agentFolder({
        definition: "---\nmodel: anthropic/claude-sonnet-5\n---\n\nBody\n",
      }),
    ]);
    expect(manifest.active.find((e) => e.class === "agent")).toBeUndefined();
    expect(manifest.withheld).toMatchObject([
      { slug: "researcher", class: "agent", reason: "invalid_definition" },
    ]);
  });

  it("withholds a nested agents/ folder with the nesting reason; parent files otherwise admit", () => {
    const { manifest } = compile([
      agentFolder({
        files: [
          { path: "INSTRUCTIONS.md", etag: "etag-1" },
          { path: "agents/helper/INSTRUCTIONS.md", etag: "etag-2" },
        ],
      }),
    ]);
    expect(manifest.withheld).toMatchObject([
      { slug: "researcher", class: "agent", reason: "nested_agent_folder" },
    ]);
  });

  it("surfaces drift when INSTRUCTIONS.md was edited after signing (AE1)", () => {
    const { manifest } = compile([
      agentFolder({
        sidecar: "signed",
        definitionForSigning: instructionsMd.replace("Cite", "Never cite"),
      }),
    ]);
    expect(manifest.withheld).toMatchObject([
      { slug: "researcher", class: "agent", reason: "definition_drift" },
    ]);
  });

  it("withholds an unsigned sidecar as a pending proposal", () => {
    const { manifest } = compile([agentFolder({ sidecar: "unsigned" })]);
    expect(manifest.withheld).toMatchObject([
      { slug: "researcher", class: "agent", reason: "unsigned" },
    ]);
  });

  it("withholds a signed disabled sidecar", () => {
    const { manifest } = compile([
      agentFolder({ sidecar: "signed", sidecarExtras: { enabled: false } }),
    ]);
    expect(manifest.withheld).toMatchObject([
      { slug: "researcher", class: "agent", reason: "disabled" },
    ]);
  });

  it("applies signed sidecar execution overrides to the entry", () => {
    const { manifest } = compile([
      agentFolder({
        sidecar: "signed",
        sidecarExtras: { policy: { execution: { maxTokens: 512 } } },
      }),
    ]);
    const entry = manifest.active.find((e) => e.class === "agent");
    expect(entry?.execution).toMatchObject({ maxTokens: 512 });
  });

  it("input signature changes when the INSTRUCTIONS.md etag changes", () => {
    const skills: Array<{ slug: string; enabled: boolean; active: boolean }> =
      [];
    const a = computeCapabilityInputSignature({
      capabilityObjects: [
        { key: "agent:researcher/INSTRUCTIONS.md", etag: "e1" },
      ],
      skills,
    });
    const b = computeCapabilityInputSignature({
      capabilityObjects: [
        { key: "agent:researcher/INSTRUCTIONS.md", etag: "e2" },
      ],
      skills,
    });
    expect(b).not.toBe(a);
  });
});

describe("agent child grant resolution (subagent-folders U5)", () => {
  const instructionsMd = `---
description: Analyst sub-agent
---

Analyze data.
`;

  function childGrantSidecar(input: {
    kind: "skill" | "connector";
    slug: string;
    operations?: string[];
    enabled?: boolean;
    signed?: boolean;
  }) {
    const base: Record<string, unknown> = {
      slug: input.slug,
      class: input.kind === "skill" ? "skill" : "connection",
      updated_at: "2026-07-05T00:00:00.000Z",
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.operations
        ? { permissions: { operations: input.operations } }
        : {}),
    };
    if (input.signed === false) return JSON.stringify(base);
    const { signed_content_sha, signature } = signCapabilitySidecar({
      signer,
      sidecar: base,
      definitionBytes: "",
      signedBy: "operator:u1",
    });
    return JSON.stringify({ ...base, signed_content_sha, signature });
  }

  function agentWithGrants(
    childGrants: Array<{
      kind: "skill" | "connector";
      slug: string;
      sidecarRaw: string | null;
    }>,
  ): CapabilityFolderInput {
    return {
      class: "agent",
      slug: "analyst",
      definitionPath: "agents/analyst/INSTRUCTIONS.md",
      definitionRaw: instructionsMd,
      definitionEtag: "etag-1",
      sidecarRaw: null,
      files: [{ path: "INSTRUCTIONS.md", etag: "etag-1" }],
      childGrants: childGrants.map((grant) => ({
        ...grant,
        path: `agents/analyst/${grant.kind === "skill" ? "skills" : "connectors"}/${grant.slug}/.assignment.json`,
      })),
    };
  }

  function rootConnection(operations: string[], permitted?: string[]) {
    return signedFolder({
      klass: "connection",
      slug: "postgres-dev",
      definition: `---
name: postgres-dev
description: Postgres dev connection.
type: mcp
operations:
${operations.map((op) => `  - ${op}`).join("\n")}
---
Postgres.
`,
      ...(permitted
        ? { sidecarExtras: { permissions: { operations: permitted } } }
        : {}),
    });
  }

  function agentEntryOf(manifest: {
    active: Array<{ class: string; slug: string }>;
  }) {
    return manifest.active.find((e) => e.class === "agent") as
      | ((typeof manifest.active)[number] & {
          grants?: Array<Record<string, unknown>>;
          withheldGrants?: Array<Record<string, unknown>>;
        })
      | undefined;
  }

  it("covers AE2: child requesting a superset of the root grant is withheld; subset admits", () => {
    const denied = compile([
      rootConnection(["query", "list", "write"], ["query", "list"]),
      agentWithGrants([
        {
          kind: "connector",
          slug: "postgres-dev",
          sidecarRaw: childGrantSidecar({
            kind: "connector",
            slug: "postgres-dev",
            operations: ["query", "write"],
          }),
        },
      ]),
    ]).manifest;
    expect(agentEntryOf(denied)?.withheldGrants).toMatchObject([
      {
        class: "connector",
        slug: "postgres-dev",
        reason: "operation_not_permitted",
      },
    ]);
    expect(agentEntryOf(denied)?.grants).toEqual([]);

    const admitted = compile([
      rootConnection(["query", "list", "write"], ["query", "list"]),
      agentWithGrants([
        {
          kind: "connector",
          slug: "postgres-dev",
          sidecarRaw: childGrantSidecar({
            kind: "connector",
            slug: "postgres-dev",
            operations: ["query"],
          }),
        },
      ]),
    ]).manifest;
    expect(agentEntryOf(admitted)?.grants).toMatchObject([
      { class: "connector", slug: "postgres-dev", operations: ["query"] },
    ]);
  });

  it("covers AE2: a missing/withheld root connection withers the child grant with no child edit", () => {
    const { manifest } = compile([
      agentWithGrants([
        {
          kind: "connector",
          slug: "postgres-dev",
          sidecarRaw: childGrantSidecar({
            kind: "connector",
            slug: "postgres-dev",
            operations: ["query"],
          }),
        },
      ]),
    ]);
    expect(agentEntryOf(manifest)?.withheldGrants).toMatchObject([
      {
        class: "connector",
        slug: "postgres-dev",
        reason: "missing_connection",
      },
    ]);
  });

  it("a child skill grant referencing an uninstalled root skill is withheld absence; compile succeeds", () => {
    const { manifest } = compile(
      [
        agentWithGrants([
          {
            kind: "skill",
            slug: "crm",
            sidecarRaw: childGrantSidecar({ kind: "skill", slug: "crm" }),
          },
        ]),
      ],
      { skills: [] },
    );
    expect(agentEntryOf(manifest)?.withheldGrants).toMatchObject([
      { class: "skill", slug: "crm", reason: "missing_skill" },
    ]);
  });

  it("an installed root skill grants the child skill", () => {
    const { manifest } = compile(
      [
        agentWithGrants([
          {
            kind: "skill",
            slug: "crm",
            sidecarRaw: childGrantSidecar({ kind: "skill", slug: "crm" }),
          },
        ]),
      ],
      { skills: [{ slug: "crm", enabled: true, active: true }] },
    );
    expect(agentEntryOf(manifest)?.grants).toMatchObject([
      { class: "skill", slug: "crm" },
    ]);
  });

  it("an unsigned child grant sidecar is withheld (R6)", () => {
    const { manifest } = compile([
      rootConnection(["query"]),
      agentWithGrants([
        {
          kind: "connector",
          slug: "postgres-dev",
          sidecarRaw: childGrantSidecar({
            kind: "connector",
            slug: "postgres-dev",
            operations: ["query"],
            signed: false,
          }),
        },
      ]),
    ]);
    expect(agentEntryOf(manifest)?.withheldGrants).toMatchObject([
      { class: "connector", slug: "postgres-dev", reason: "unsigned" },
    ]);
  });

  it("no child folders → agent entry admits with an empty grant surface", () => {
    const { manifest } = compile([agentWithGrants([])]);
    const entry = agentEntryOf(manifest);
    expect(entry).toBeDefined();
    expect(entry?.grants).toEqual([]);
    expect(entry?.withheldGrants).toBeUndefined();
  });
});

describe("agent entry builtInTools (subagent-folders U7)", () => {
  it("carries the built-in tool surface onto the manifest entry", () => {
    const { manifest } = compile([
      {
        class: "agent",
        slug: "research",
        definitionPath: "agents/research/INSTRUCTIONS.md",
        definitionRaw:
          "---\ndescription: Researcher\nbuiltInTools:\n  - web-search\n---\n\nResearch.\n",
        definitionEtag: "e1",
        sidecarRaw: null,
        files: [{ path: "INSTRUCTIONS.md", etag: "e1" }],
      },
    ]);
    const entry = manifest.active.find((e) => e.class === "agent");
    expect(entry?.builtInTools).toEqual(["web-search"]);
  });
});

// ── THINK-302 U3: registry-trust admission ──────────────────────────────────

const AGENT_SCOPE = "agent:agent-1";

/** A bare marker folder (no sidecar) — the flag-on end state. */
function markerFolder(input: {
  klass: "connection" | "tool" | "agent" | "mcp";
  slug: string;
  definition: string;
  scopeRef?: string;
  extraFiles?: Array<{ path: string; content: string; etag: string }>;
}): CapabilityFolderInput {
  const definitionPath =
    input.klass === "agent"
      ? `agents/${input.slug}/INSTRUCTIONS.md`
      : input.klass === "mcp"
        ? `mcp/${input.slug}/MCP.md`
        : `${input.klass}s/${input.slug}/${
            input.klass === "connection" ? "CONNECTION.md" : "TOOL.md"
          }`;
  const markerName = definitionPath.split("/").pop()!;
  const files = [
    { path: markerName, etag: `"etag-${input.slug}-marker"` },
    ...(input.extraFiles ?? []).map((f) => ({ path: f.path, etag: f.etag })),
  ];
  return {
    class: input.klass,
    slug: input.slug,
    definitionPath,
    definitionRaw: input.definition,
    definitionEtag: `"etag-${input.slug}-marker"`,
    sidecarRaw: null,
    scopeRef: input.scopeRef ?? AGENT_SCOPE,
    files,
  };
}

/** Build the binding a marker folder would need to be admitted. */
function bindingFor(
  folder: CapabilityFolderInput,
  markerContents: Record<string, string>,
): CapabilityApprovalRow {
  const attestationFiles = (folder.files ?? []).map((f) => ({
    path: f.path,
    content: markerContents[f.path] ?? "",
  }));
  return {
    id: `binding-${folder.slug}`,
    tenant_id: agent.tenantId,
    scope_ref: folder.scopeRef!,
    class: folder.class,
    slug: folder.slug,
    marker_sha: definitionContentSha(folder.definitionRaw!),
    folder_attestation_sha: computeFolderAttestation(attestationFiles),
    files_etag_signature: filesEtagSignature(folder.files ?? []),
    definition_id: null,
    signed_by: "operator:eric",
    signed_at: new Date("2026-07-16T00:00:00Z"),
    created_at: new Date("2026-07-16T00:00:00Z"),
  } as CapabilityApprovalRow;
}

function registryCompile(
  folders: CapabilityFolderInput[],
  registry: RegistryTrustInput,
) {
  return compileCapabilitiesManifest({
    agent,
    folders,
    skills: [],
    verifier,
    signer,
    inputSignature: "sig-1",
    generatedAt: "2026-07-16T00:00:00.000Z",
    registry,
  });
}

describe("registry-trust admission (THINK-302 U3)", () => {
  const scrapeMarker = `---\nname: scrape-api\ndescription: Scrape API.\ntype: api\nurl: https://api.example.dev\noperations:\n  - scrape\n---\nScrape connection.\n`;

  function boundSetup(overrides?: { approval?: string; definition?: string }) {
    const definition =
      overrides?.definition ??
      (overrides?.approval
        ? scrapeMarker.replace(
            "operations:",
            `approval: ${overrides.approval}\noperations:`,
          )
        : scrapeMarker);
    const folder = markerFolder({
      klass: "connection",
      slug: "scrape-api",
      definition,
    });
    const binding = bindingFor(folder, {
      "CONNECTION.md": definition,
    });
    const bindings = new Map<string, CapabilityApprovalRow>([
      [bindingScanKey(AGENT_SCOPE, "connection", "scrape-api"), binding],
    ]);
    return { folder, binding, bindings };
  }

  it("admits a bound marker folder with no sidecar and stamps source_scope", () => {
    const { folder, bindings } = boundSetup();
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings,
    });
    const entry = manifest.active.find((e) => e.slug === "scrape-api");
    expect(entry).toBeTruthy();
    expect(entry!.source_scope).toBe(AGENT_SCOPE);
    expect(manifest.withheld).toEqual([]);
  });

  it("withholds an unbound marker folder as unsigned (AE1)", () => {
    const { folder } = boundSetup();
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings: new Map(),
    });
    expect(manifest.active.some((e) => e.slug === "scrape-api")).toBe(false);
    expect(manifest.withheld).toEqual([
      { slug: "scrape-api", class: "connection", reason: "unsigned" },
    ]);
  });

  it("withholds definition_drift when the marker bytes changed after binding", () => {
    const { folder, bindings } = boundSetup();
    const drifted = {
      ...folder,
      definitionRaw: folder.definitionRaw!.replace(
        "Scrape connection.",
        "Scrape connection (edited).",
      ),
    };
    const { manifest } = registryCompile([drifted], {
      registryTrust: true,
      bindings,
    });
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "scrape-api",
        reason: "definition_drift",
        detail: expect.stringContaining("marker"),
      }),
    ]);
  });

  it("AE3/attestation: a non-marker folder file edit (script swap) drifts", () => {
    const definition = `---\nname: runner\ndescription: d\nkind: script\nentry: run.sh\n---\nRunner.\n`;
    const folder = markerFolder({
      klass: "tool",
      slug: "runner",
      definition,
      extraFiles: [
        {
          path: "run.sh",
          content: "#!/bin/sh\necho ok",
          etag: '"etag-run-v1"',
        },
      ],
    });
    const binding = bindingFor(folder, {
      "TOOL.md": definition,
      "run.sh": "#!/bin/sh\necho ok",
    });
    const bindings = new Map([
      [bindingScanKey(AGENT_SCOPE, "tool", "runner"), binding],
    ]);
    // Same marker, but run.sh re-uploaded with a new etag → attestation flips.
    const swapped = {
      ...folder,
      files: folder.files!.map((f) =>
        f.path === "run.sh" ? { ...f, etag: '"etag-run-v2"' } : f,
      ),
    };
    const { manifest } = registryCompile([swapped], {
      registryTrust: true,
      bindings,
    });
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "runner",
        reason: "definition_drift",
        detail: expect.stringContaining("folder contents"),
      }),
    ]);
  });

  it("AE10 copy-to-root: bytes bound at space scope do not admit at agent scope", () => {
    const { folder } = boundSetup();
    // Binding exists, but only for space:<id> — the agent-scope lookup misses.
    const spaceBinding = bindingFor(
      { ...folder, scopeRef: "space:space-9" },
      { "CONNECTION.md": folder.definitionRaw! },
    );
    const bindings = new Map([
      [
        bindingScanKey("space:space-9", "connection", "scrape-api"),
        spaceBinding,
      ],
    ]);
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings,
    });
    expect(manifest.active.some((e) => e.slug === "scrape-api")).toBe(false);
    expect(manifest.withheld[0]!.reason).toBe("unsigned");
  });

  it("keeps the approval_gated withhold under registry trust (pre-U12)", () => {
    const { folder, bindings } = boundSetup({ approval: "always" });
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings,
    });
    expect(manifest.active.some((e) => e.slug === "scrape-api")).toBe(false);
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "scrape-api",
        reason: "approval_gated",
      }),
    ]);
  });

  it("fails closed to unsigned when the binding lookup was unavailable", () => {
    const { folder } = boundSetup();
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings: new Map(),
      bindingsUnavailable: true,
    });
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "scrape-api",
        reason: "unsigned",
        detail: expect.stringContaining("registry lookup unavailable"),
      }),
    ]);
  });

  it("dual-read: an unbound marker WITH a signed sidecar still admits via fallback", () => {
    // A not-yet-backfilled grant keeps its signed sidecar; registry trust on
    // but no binding → the compiler verifies the legacy sidecar.
    const folder = signedFolder({
      klass: "connection",
      slug: "firecrawl",
      definition: connectionMd,
    });
    const { manifest } = registryCompile(
      [{ ...folder, scopeRef: AGENT_SCOPE }],
      { registryTrust: true, bindings: new Map() },
    );
    const entry = manifest.active.find((e) => e.slug === "firecrawl");
    expect(entry).toBeTruthy();
    // Fallback path stamps the scope too.
    expect(entry!.source_scope).toBe(AGENT_SCOPE);
  });

  it("input signature folds in bound shas so a DB-only approval busts the skip cache", () => {
    const { folder, binding } = boundSetup();
    const base = computeCapabilityInputSignature({
      capabilityObjects: (folder.files ?? []).map((f) => ({
        key: `connection:scrape-api/${f.path}`,
        etag: f.etag,
      })),
      skills: [],
    });
    const withBinding = computeCapabilityInputSignature({
      capabilityObjects: (folder.files ?? []).map((f) => ({
        key: `connection:scrape-api/${f.path}`,
        etag: f.etag,
      })),
      skills: [],
      bindings: [
        {
          key: bindingScanKey(AGENT_SCOPE, "connection", "scrape-api"),
          markerSha: binding.marker_sha,
          attestationSha: binding.folder_attestation_sha,
        },
      ],
    });
    // Same S3 etags, different registry state → different signature.
    expect(withBinding).not.toBe(base);
  });
});

describe("mcp first-class class (THINK-302 U4)", () => {
  const mcpMarker = `---\nname: dagster\ndescription: Dagster orchestration MCP.\nserver: srv-registry-ref\nenabled_tools:\n  - launch_run\n  - get_run_status\n---\nUse for pipelines.\n`;

  function mcpSetup(overrides?: { approval?: string; definition?: string }) {
    const definition =
      overrides?.definition ??
      (overrides?.approval
        ? mcpMarker.replace(
            "server:",
            `approval: ${overrides.approval}\nserver:`,
          )
        : mcpMarker);
    const folder = markerFolder({
      klass: "mcp",
      slug: "dagster",
      definition,
    });
    const binding = bindingFor(folder, { "MCP.md": definition });
    const bindings = new Map([
      [bindingScanKey(AGENT_SCOPE, "mcp", "dagster"), binding],
    ]);
    return { folder, bindings };
  }

  it("compiles a bound MCP.md folder into an active mcp entry with server + tools", () => {
    const { folder, bindings } = mcpSetup();
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings,
    });
    const entry = manifest.active.find((e) => e.class === "mcp");
    expect(entry).toMatchObject({
      name: "dagster",
      slug: "dagster",
      class: "mcp",
      server: "srv-registry-ref",
      enabledTools: ["launch_run", "get_run_status"],
      source_scope: AGENT_SCOPE,
    });
    expect(manifest.withheld).toEqual([]);
  });

  it("withholds an unbound mcp folder as unsigned (no legacy sidecar path)", () => {
    const { folder } = mcpSetup();
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings: new Map(),
    });
    expect(manifest.active.some((e) => e.class === "mcp")).toBe(false);
    expect(manifest.withheld).toEqual([
      { slug: "dagster", class: "mcp", reason: "unsigned" },
    ]);
  });

  it("withholds mcp entirely when registry trust is off", () => {
    const { folder } = mcpSetup();
    const { manifest } = registryCompile([folder], {
      registryTrust: false,
      bindings: new Map(),
    });
    expect(manifest.withheld).toEqual([
      expect.objectContaining({
        slug: "dagster",
        class: "mcp",
        reason: "unsigned",
        detail: expect.stringContaining("registry trust"),
      }),
    ]);
  });

  it("drifts when the MCP.md marker changed after binding", () => {
    const { folder, bindings } = mcpSetup();
    const drifted = {
      ...folder,
      definitionRaw: folder.definitionRaw!.replace(
        "Use for pipelines.",
        "Use for pipelines (edited).",
      ),
    };
    const { manifest } = registryCompile([drifted], {
      registryTrust: true,
      bindings,
    });
    expect(manifest.withheld).toEqual([
      expect.objectContaining({ slug: "dagster", reason: "definition_drift" }),
    ]);
  });

  it("keeps the approval_gated withhold for a gated mcp grant (pre-U12)", () => {
    const { folder, bindings } = mcpSetup({ approval: "always" });
    const { manifest } = registryCompile([folder], {
      registryTrust: true,
      bindings,
    });
    expect(manifest.active.some((e) => e.class === "mcp")).toBe(false);
    expect(manifest.withheld).toEqual([
      expect.objectContaining({ slug: "dagster", reason: "approval_gated" }),
    ]);
  });
});

describe("compile revision (THINK-302 U3)", () => {
  it("rev 6 pins registry-trust admission — the bump feeds the input signature so every previously rendered manifest recompiles", () => {
    // Deliberate pin: bump this expectation ONLY alongside a real
    // compile-behavior change (each bump forces a fleet-wide recompile
    // and an eval-fingerprint discontinuity announcement).
    expect(CAPABILITY_COMPILE_REVISION).toBe(6);
    // The revision is part of the signature payload: identical inputs
    // yield a signature that can only match manifests compiled at the
    // same revision.
    const signature = computeCapabilityInputSignature({
      capabilityObjects: [],
      skills: [],
    });
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("most-specific-scope-wins (THINK-302 U5 / R16 / KTD-4)", () => {
  function entry(
    slug: string,
    klass: CapabilityManifestEntry["class"],
    sourceScope?: string,
  ): CapabilityManifestEntry {
    return {
      name: slug,
      slug,
      class: klass,
      ...(sourceScope ? { source_scope: sourceScope } : {}),
    };
  }

  it("ranks user > space > sub-agent > root; unknown/absent lowest", () => {
    expect(scopeSpecificity("user:u1")).toBe(3);
    expect(scopeSpecificity("space:s1")).toBe(2);
    expect(scopeSpecificity("agent:a1/sub:helper")).toBe(1);
    expect(scopeSpecificity("agent:a1")).toBe(0);
    expect(scopeSpecificity(undefined)).toBe(-1);
    expect(scopeSpecificity("weird")).toBe(-1);
  });

  it("keeps only the most specific scope on a (class, slug) collision", () => {
    const result = selectMostSpecificScope([
      entry("report", "skill", "agent:a1"),
      entry("report", "skill", "user:u1"),
      entry("report", "skill", "space:s1"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.source_scope).toBe("user:u1");
  });

  it("does not collapse different slugs or classes", () => {
    const result = selectMostSpecificScope([
      entry("a", "skill", "agent:a1"),
      entry("a", "tool", "user:u1"), // different class → distinct identity
      entry("b", "skill", "space:s1"),
    ]);
    expect(result).toHaveLength(3);
  });

  it("passes through entries without a source_scope untouched (byte-identical single scope)", () => {
    const entries = [
      entry("web-search", "builtin"),
      entry("sales", "skill"),
      entry("firecrawl", "connection", "agent:a1"),
    ];
    expect(selectMostSpecificScope(entries)).toEqual(entries);
  });

  it("compile: a user-scoped grant supersedes the same slug at agent root", () => {
    const connectionMd = (name: string) =>
      `---\nname: ${name}\ndescription: Shared conn.\ntype: api\nurl: https://api.example.dev\noperations:\n  - read\n---\nShared.\n`;
    const rootFolder = markerFolder({
      klass: "connection",
      slug: "shared-conn",
      definition: connectionMd("shared-conn"),
      scopeRef: "agent:agent-1",
    });
    const userFolder = markerFolder({
      klass: "connection",
      slug: "shared-conn",
      definition: connectionMd("shared-conn"),
      scopeRef: "user:user-9",
    });
    const bindings = new Map([
      [
        bindingScanKey("agent:agent-1", "connection", "shared-conn"),
        bindingFor(rootFolder, { "CONNECTION.md": rootFolder.definitionRaw! }),
      ],
      [
        bindingScanKey("user:user-9", "connection", "shared-conn"),
        bindingFor(userFolder, { "CONNECTION.md": userFolder.definitionRaw! }),
      ],
    ]);
    const { manifest } = registryCompile([rootFolder, userFolder], {
      registryTrust: true,
      bindings,
    });
    const entries = manifest.active.filter((e) => e.slug === "shared-conn");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source_scope).toBe("user:user-9");
    expect(manifest.withheld).toEqual([]);
  });
});
