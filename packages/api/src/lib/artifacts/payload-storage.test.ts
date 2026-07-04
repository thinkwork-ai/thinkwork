import { describe, expect, it } from "vitest";
import {
  artifactContentKey,
  artifactRenderKey,
  assertArtifactPayloadS3Key,
  isArtifactPayloadS3Key,
} from "./payload-storage.js";

const tenantId = "11111111-1111-1111-1111-111111111111";
const artifactId = "22222222-2222-2222-2222-222222222222";

describe("artifactRenderKey (THINK-147 KTD4)", () => {
  it("returns the overwrite-in-place head key without a revision", () => {
    expect(artifactRenderKey({ tenantId, artifactId })).toBe(
      `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/render.html`,
    );
  });

  it("returns the content-addressed pin key with a revision", () => {
    expect(
      artifactRenderKey({ tenantId, artifactId, revision: "abc123" }),
    ).toBe(
      `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/render/abc123.html`,
    );
  });
});

describe("assertArtifactPayloadS3Key render shapes", () => {
  it("accepts the render head key for the owning tenant", () => {
    const key = artifactRenderKey({ tenantId, artifactId });
    expect(assertArtifactPayloadS3Key(tenantId, key)).toBe(key);
  });

  it("accepts a render revision key for the owning tenant", () => {
    const key = artifactRenderKey({ tenantId, artifactId, revision: "hash" });
    expect(assertArtifactPayloadS3Key(tenantId, key)).toBe(key);
  });

  it("still accepts the markdown content keys", () => {
    const head = artifactContentKey({ tenantId, artifactId });
    const pin = artifactContentKey({ tenantId, artifactId, revision: "h" });
    expect(assertArtifactPayloadS3Key(tenantId, head)).toBe(head);
    expect(assertArtifactPayloadS3Key(tenantId, pin)).toBe(pin);
  });

  it("rejects a cross-tenant render key", () => {
    const key = artifactRenderKey({
      tenantId: "33333333-3333-3333-3333-333333333333",
      artifactId,
    });
    expect(isArtifactPayloadS3Key(tenantId, key)).toBe(false);
  });

  it("rejects traversal and non-html suffixes", () => {
    expect(
      isArtifactPayloadS3Key(
        tenantId,
        `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/render/../content.md`,
      ),
    ).toBe(false);
    expect(
      isArtifactPayloadS3Key(
        tenantId,
        `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/render/evil.js`,
      ),
    ).toBe(false);
  });
});
