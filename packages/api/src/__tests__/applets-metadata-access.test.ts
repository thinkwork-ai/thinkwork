import { describe, expect, it } from "vitest";
import {
  assertAppletArtifactAccess,
  assertCanWriteApplet,
} from "../lib/applets/access.js";
import {
  parseAppletMetadataV1,
  type AppletMetadataV1,
} from "../lib/applets/metadata.js";

describe("applet metadata and access", () => {
  it("parses valid metadata", () => {
    expect(parseAppletMetadataV1(validAppletMetadata())).toMatchObject({
      appId: "pipeline-risk",
      tenantId: "tenant-A",
      kind: "computer_applet",
    });
  });

  it("rejects metadata missing required contract fields", () => {
    expect(() =>
      parseAppletMetadataV1({
        ...validAppletMetadata(),
        stdlibVersionAtGeneration: undefined,
      }),
    ).toThrow(/stdlibVersionAtGeneration/);
  });

  it("allows same-tenant applet reads", () => {
    const metadata = assertAppletArtifactAccess(appletRow(), {
      tenantId: "tenant-A",
      userId: "user-1",
    });

    expect(metadata.appId).toBe("pipeline-risk");
  });

  it("denies cross-tenant reads with a not-found shaped error", () => {
    expect(() =>
      assertAppletArtifactAccess(appletRow(), {
        tenantId: "tenant-B",
        userId: "user-1",
      }),
    ).toThrow("Applet artifact not found");
  });

  it("requires service auth for inert applet writes", () => {
    expect(() =>
      assertCanWriteApplet(
        { auth: { authType: "cognito", tenantId: "tenant-A" } } as any,
        "tenant-A",
      ),
    ).toThrow("Applet writes require service authentication");

    expect(() =>
      assertCanWriteApplet(
        { auth: { authType: "apikey", tenantId: "tenant-A" } } as any,
        "tenant-A",
      ),
    ).not.toThrow();
  });
});

function appletRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    tenant_id: "tenant-A",
    thread_id: "thread-1",
    type: "applet",
    s3_key: "tenants/tenant-A/applets/pipeline-risk/source.tsx",
    metadata: validAppletMetadata(),
    ...overrides,
  };
}

function validAppletMetadata(
  overrides: Partial<AppletMetadataV1> = {},
): AppletMetadataV1 {
  return {
    schemaVersion: 1,
    kind: "computer_applet",
    appId: "pipeline-risk",
    name: "Pipeline Risk",
    version: 1,
    tenantId: "tenant-A",
    threadId: "thread-1",
    prompt: "Show pipeline risk.",
    agentVersion: "agent-v1",
    modelId: "us.amazon.nova-pro-v1:0",
    generatedAt: "2026-05-09T12:00:00.000Z",
    stdlibVersionAtGeneration: "0.0.0",
    ...overrides,
  };
}
