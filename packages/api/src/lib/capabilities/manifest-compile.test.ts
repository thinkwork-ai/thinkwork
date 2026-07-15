import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileCapabilitiesManifest,
  computeCapabilityInputSignature,
  parseCapabilitiesManifest,
  type CapabilityFolderInput,
} from "./manifest-compile.js";
import { legacyPrincipalRemediation } from "./definition-schemas.js";
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  signCapabilitySidecar,
} from "./sidecar-signing.js";

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
