import { describe, expect, it } from "vitest";

import {
  CAPABILITY_SDK_BOOTSTRAP_MODE,
  CAPABILITY_SDK_MODULE_FILES,
  CAPABILITY_SDK_TARGET_DIR,
  buildCapabilitySdkBootstrapContent,
  capabilitySdkBootstrapTarget,
  capabilitySdkSourceFiles,
} from "../src/runtime/capability-sdk-source";

describe("capability-sdk source bundler", () => {
  it("returns the pure-stdlib Python SDK files with content", () => {
    const files = capabilitySdkSourceFiles();
    const names = files.map((f) => f.path);
    expect(names).toEqual([
      "capability_sdk/canonical.py",
      "capability_sdk/ed25519.py",
      "capability_sdk/client.py",
      "capability_sdk/__init__.py",
    ]);
    // Every module file is present and non-trivial.
    expect(files.length).toBe(CAPABILITY_SDK_MODULE_FILES.length);
    for (const file of files) {
      expect(file.content.length).toBeGreaterThan(200);
    }
  });

  it("ships an Ed25519 signer and RFC 8785 canonicalizer, no third-party imports", () => {
    const byName = Object.fromEntries(
      capabilitySdkSourceFiles().map((f) => [f.path, f.content]),
    );
    const ed = byName["capability_sdk/ed25519.py"];
    const canon = byName["capability_sdk/canonical.py"];
    const client = byName["capability_sdk/client.py"];
    // Pure stdlib only — no cryptography/nacl/pynacl/requests anywhere.
    for (const src of [ed, canon, client]) {
      expect(src).not.toMatch(
        /\b(import|from)\s+(cryptography|nacl|pynacl|requests|boto3)\b/,
      );
    }
    expect(ed).toContain("def sign(");
    expect(ed).toContain("hashlib.sha512");
    expect(canon).toContain("utf-16-be"); // UTF-16 code-unit key ordering
    expect(client).toContain("CapabilityBrokerClient");
  });

  it("honors a custom target dir", () => {
    const files = capabilitySdkSourceFiles("twcap_sdk");
    expect(files[0].path).toBe("twcap_sdk/canonical.py");
  });

  it("builds a bootstrap file matching the SessionBootstrap wire shape", () => {
    const content = buildCapabilitySdkBootstrapContent({
      sessionId: "sess-1",
      audience: "aud",
      brokerEndpoint: "vpce-x.execute-api.us-east-1.vpce.amazonaws.com",
      brokerApiId: "api1",
      privateKey: "BASE64PKCS8",
      nextSequence: 0,
      expiresAt: "2026-07-13T00:15:00.000Z",
      region: "us-east-1",
    });
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({
      sessionId: "sess-1",
      audience: "aud",
      brokerEndpoint: "vpce-x.execute-api.us-east-1.vpce.amazonaws.com",
      brokerApiId: "api1",
      privateKey: "BASE64PKCS8",
      nextSequence: 0,
      expiresAt: "2026-07-13T00:15:00.000Z",
      region: "us-east-1",
    });
    expect(content.endsWith("\n")).toBe(true);
  });

  it("omits optional transport fields when unset", () => {
    const parsed = JSON.parse(
      buildCapabilitySdkBootstrapContent({
        sessionId: "s",
        audience: "a",
        brokerEndpoint: "e",
        brokerApiId: "i",
        privateKey: "k",
        nextSequence: 3,
        expiresAt: "2026-07-13T00:15:00.000Z",
      }),
    );
    expect(parsed).not.toHaveProperty("region");
    expect(parsed).not.toHaveProperty("invokePath");
    expect(parsed).not.toHaveProperty("hostHeader");
  });

  it("exposes the reserved 0600 bootstrap target", () => {
    const target = capabilitySdkBootstrapTarget();
    expect(target.path).toBe(
      `${CAPABILITY_SDK_TARGET_DIR}/session-bootstrap.json`,
    );
    expect(target.mode).toBe(CAPABILITY_SDK_BOOTSTRAP_MODE);
    expect(CAPABILITY_SDK_BOOTSTRAP_MODE).toBe(0o600);
  });
});
