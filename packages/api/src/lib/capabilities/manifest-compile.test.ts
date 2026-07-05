import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compileCapabilitiesManifest,
  computeCapabilityInputSignature,
  parseCapabilitiesManifest,
  type CapabilityFolderInput,
} from "./manifest-compile.js";
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
