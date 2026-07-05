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
