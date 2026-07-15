import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  capabilityDefinitionKey,
  capabilitySidecarKey,
  connectionDefinitionFromRegistryRow,
  putCapabilityFolder,
  removeCapabilityFolder,
  removeCapabilitySidecar,
  signExistingCapabilityFolder,
  resignCapabilityFolderSidecarIfPresent,
  putAgentChildGrantSidecar,
} from "./folder-write.js";
import {
  capabilitySignerFromKey,
  capabilityVerifierFromKey,
  verifyCapabilitySidecar,
} from "./sidecar-signing.js";
import { parseConnectionDefinition } from "./definition-schemas.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = capabilitySignerFromKey(privateKey);
const verifier = capabilityVerifierFromKey(publicKey);

const PREFIX = "tenants/acme/agents/ops/";

/** In-memory S3 double for Get/Put/Delete on capability keys. */
function fakeS3(seed: Record<string, string> = {}) {
  const objects = new Map(Object.entries(seed));
  return {
    objects,
    send: vi.fn(async (command: any) => {
      const name = command.constructor.name;
      const key = command.input.Key as string;
      if (name === "GetObjectCommand") {
        if (!objects.has(key)) {
          const err = new Error("NoSuchKey");
          (err as any).name = "NoSuchKey";
          throw err;
        }
        return { Body: { transformToString: async () => objects.get(key)! } };
      }
      if (name === "PutObjectCommand") {
        objects.set(key, command.input.Body as string);
        return {};
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(key);
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    }),
  };
}

const DEFINITION = `---
name: firecrawl
description: Firecrawl API.
type: api
---
Firecrawl.
`;

describe("signExistingCapabilityFolder (grant-as-approve)", () => {
  it("signs the exact definition bytes present at approval (R18)", async () => {
    const s3 = fakeS3({
      [capabilityDefinitionKey(PREFIX, "connection", "firecrawl")]: DEFINITION,
    });
    const result = await signExistingCapabilityFolder({
      targetPrefix: PREFIX,
      klass: "connection",
      slug: "firecrawl",
      sidecar: { enabled: true, permissions: { operations: ["scrape"] } },
      signedBy: "operator:user-1",
      deps: { s3: s3 as any, bucket: "b", signer },
    });
    expect(result).toEqual({ ok: true });
    const sidecar = JSON.parse(
      s3.objects.get(capabilitySidecarKey(PREFIX, "connection", "firecrawl"))!,
    ) as Record<string, unknown>;
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar,
        definitionBytes: DEFINITION,
      }),
    ).toEqual({ ok: true });
    // A post-approval rewrite drifts:
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar,
        definitionBytes: DEFINITION + "swap",
      }),
    ).toEqual({ ok: false, reason: "definition_drift" });
    expect((sidecar.signature as { signed_by: string }).signed_by).toBe(
      "operator:user-1",
    );
  });

  it("refuses to grant a folder with no definition", async () => {
    const s3 = fakeS3();
    const result = await signExistingCapabilityFolder({
      targetPrefix: PREFIX,
      klass: "tool",
      slug: "ghost",
      sidecar: {},
      signedBy: "operator:user-1",
      deps: { s3: s3 as any, bucket: "b", signer },
    });
    expect(result).toEqual({ ok: false, reason: "definition_missing" });
  });

  it("fails closed when no signer is configured", async () => {
    const s3 = fakeS3({
      [capabilityDefinitionKey(PREFIX, "connection", "firecrawl")]: DEFINITION,
    });
    const result = await signExistingCapabilityFolder({
      targetPrefix: PREFIX,
      klass: "connection",
      slug: "firecrawl",
      sidecar: {},
      signedBy: "operator:user-1",
      deps: { s3: s3 as any, bucket: "b", signer: null },
    });
    expect(result).toEqual({ ok: false, reason: "signing_unavailable" });
    expect(
      s3.objects.has(capabilitySidecarKey(PREFIX, "connection", "firecrawl")),
    ).toBe(false);
  });
});

describe("putCapabilityFolder + removal semantics", () => {
  it("writes definition + verifiable sidecar (dual-write/backfill path)", async () => {
    const s3 = fakeS3();
    const result = await putCapabilityFolder({
      targetPrefix: PREFIX,
      klass: "connection",
      slug: "linear",
      definition: DEFINITION,
      sidecar: { enabled: true, config: { registryServerId: "srv-1" } },
      signedBy: "backfill",
      deps: { s3: s3 as any, bucket: "b", signer },
    });
    expect(result).toEqual({ ok: true });
    const sidecar = JSON.parse(
      s3.objects.get(capabilitySidecarKey(PREFIX, "connection", "linear"))!,
    ) as Record<string, unknown>;
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar,
        definitionBytes: DEFINITION,
      }),
    ).toEqual({ ok: true });
    expect(
      (sidecar.config as { registryServerId: string }).registryServerId,
    ).toBe("srv-1");
  });

  it("removeCapabilitySidecar leaves the definition as an inert proposal", async () => {
    const defKey = capabilityDefinitionKey(PREFIX, "tool", "t1");
    const sideKey = capabilitySidecarKey(PREFIX, "tool", "t1");
    const s3 = fakeS3({ [defKey]: DEFINITION, [sideKey]: "{}" });
    await removeCapabilitySidecar({
      targetPrefix: PREFIX,
      klass: "tool",
      slug: "t1",
      deps: { s3: s3 as any, bucket: "b" },
    });
    expect(s3.objects.has(sideKey)).toBe(false);
    expect(s3.objects.has(defKey)).toBe(true);

    await removeCapabilityFolder({
      targetPrefix: PREFIX,
      klass: "tool",
      slug: "t1",
      deps: { s3: s3 as any, bucket: "b" },
    });
    expect(s3.objects.has(defKey)).toBe(false);
  });
});

describe("connectionDefinitionFromRegistryRow", () => {
  it("produces a parseable CONNECTION.md with refs only", () => {
    const { slug, definition } = connectionDefinitionFromRegistryRow({
      slug: "Linear MCP",
      name: "Linear",
      url: "https://mcp.linear.app/sse",
      transport: "sse",
      // Bare strings are valid op names (tools jsonb shape varies);
      // shapeless objects drop.
      tools: [{ name: "list_issues" }, { name: "save_issue" }, "extra_op", {}],
    });
    expect(slug).toBe("linear-mcp");
    const parsed = parseConnectionDefinition(
      definition,
      "connections/linear-mcp/CONNECTION.md",
    );
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    expect(parsed.parsed.type).toBe("mcp");
    expect(parsed.parsed.operations).toEqual([
      "list_issues",
      "save_issue",
      "extra_op",
    ]);
    expect(definition).not.toContain("auth_config");
  });
});

describe("resignCapabilityFolderSidecarIfPresent (subagent-folders U6)", () => {
  const INSTRUCTIONS = `---
description: Deep research specialist
---

Research thoroughly.
`;
  const EDITED = INSTRUCTIONS.replace("thoroughly", "very thoroughly");

  async function seededAgentFolder() {
    const s3 = fakeS3();
    const put = await putCapabilityFolder({
      targetPrefix: PREFIX,
      klass: "agent",
      slug: "researcher",
      definition: INSTRUCTIONS,
      sidecar: {
        enabled: true,
        policy: { execution: { maxTokens: 512 } },
      },
      signedBy: "operator:u1",
      deps: { s3, bucket: "b", signer },
    });
    expect(put.ok).toBe(true);
    return s3;
  }

  it("re-signs the existing sidecar over the edited definition, preserving fields", async () => {
    const s3 = await seededAgentFolder();
    // Operator edits INSTRUCTIONS.md → signature is now stale (drift).
    const defKey = capabilityDefinitionKey(PREFIX, "agent", "researcher");
    expect(defKey).toBe(`${PREFIX}agents/researcher/INSTRUCTIONS.md`);
    s3.objects.set(defKey, EDITED);
    const stale = JSON.parse(
      s3.objects.get(capabilitySidecarKey(PREFIX, "agent", "researcher"))!,
    );
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar: stale,
        definitionBytes: EDITED,
      }),
    ).toMatchObject({ ok: false, reason: "definition_drift" });

    const result = await resignCapabilityFolderSidecarIfPresent({
      targetPrefix: PREFIX,
      klass: "agent",
      slug: "researcher",
      signedBy: "operator:admin-1",
      deps: { s3, bucket: "b", signer },
    });
    expect(result.ok).toBe(true);

    const resigned = JSON.parse(
      s3.objects.get(capabilitySidecarKey(PREFIX, "agent", "researcher"))!,
    );
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar: resigned,
        definitionBytes: EDITED,
      }),
    ).toEqual({ ok: true });
    expect(resigned.enabled).toBe(true);
    expect(resigned.policy).toEqual({ execution: { maxTokens: 512 } });
    expect(resigned.signature.signed_by).toBe("operator:admin-1");
  });

  it("is a no-op skip when the folder has no sidecar (skills convention)", async () => {
    const s3 = fakeS3({
      [capabilityDefinitionKey(PREFIX, "agent", "researcher")]: INSTRUCTIONS,
    });
    const result = await resignCapabilityFolderSidecarIfPresent({
      targetPrefix: PREFIX,
      klass: "agent",
      slug: "researcher",
      signedBy: "operator:admin-1",
      deps: { s3, bucket: "b", signer },
    });
    expect(result).toEqual({ ok: true, skipped: "no_sidecar" });
    expect(
      s3.objects.has(capabilitySidecarKey(PREFIX, "agent", "researcher")),
    ).toBe(false);
  });

  it("fails typed when signing is unavailable", async () => {
    const s3 = await seededAgentFolder();
    const result = await resignCapabilityFolderSidecarIfPresent({
      targetPrefix: PREFIX,
      klass: "agent",
      slug: "researcher",
      signedBy: "operator:admin-1",
      deps: { s3, bucket: "b", signer: null },
    });
    expect(result).toMatchObject({ ok: false, reason: "signing_unavailable" });
  });
});

describe("putAgentChildGrantSidecar (subagent-folders U7)", () => {
  it("writes a signed narrowing sidecar under the greenfield connectors/ path", async () => {
    const s3 = fakeS3();
    const result = await putAgentChildGrantSidecar({
      targetPrefix: PREFIX,
      agentProfileSlug: "analyst",
      childClass: "connection",
      slug: "postgres-dev",
      operations: ["query"],
      signedBy: "operator:provision-analyst-connector",
      deps: { s3, bucket: "b", signer },
    });
    expect(result.ok).toBe(true);
    const key = `${PREFIX}agents/analyst/connectors/postgres-dev/.assignment.json`;
    const sidecar = JSON.parse(s3.objects.get(key)!);
    expect(sidecar).toMatchObject({
      slug: "postgres-dev",
      class: "connection",
      permissions: { operations: ["query"] },
    });
    // Signed over empty definition bytes — the sidecar IS the grant.
    expect(
      verifyCapabilitySidecar({
        verifier,
        sidecar,
        definitionBytes: "",
      }),
    ).toEqual({ ok: true });
  });
});
