import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assessDeploymentProfile,
  buildDeploymentProfile,
  deploymentProfileCanonicalJson,
  deploymentProfileSha256,
  parseDeploymentProfileJson,
  profileToRuntimeConfig,
  signDeploymentProfile,
  verifyDeploymentProfile,
  type DeploymentProfile,
} from "../src/index";

const baseProfile = (): DeploymentProfile =>
  buildDeploymentProfile({
    deploymentId: "tw-customer-dev",
    displayName: "Acme ThinkWork",
    stage: "dev",
    region: "us-east-1",
    issuedAt: "2026-06-06T12:00:00.000Z",
    spacesUrl: "https://spaces.example.com",
    apiUrl: "https://api.example.com",
    graphqlHttpUrl: "https://api.example.com/graphql",
    appsyncHttpUrl: "https://appsync.example.com/graphql",
    appsyncWsUrl: "wss://appsync.example.com/graphql",
    cognitoDomain: "auth.example.com",
    cognitoUserPoolId: "us-east-1_abc123",
    cognitoClientId: "client-123",
  });

function testKeyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    privateKeyPem: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
}

describe("deployment profile contract", () => {
  it("verifies a signed profile with a trusted key", async () => {
    const key = testKeyPair();
    const signed = await signDeploymentProfile({
      profile: baseProfile(),
      keyId: "deployment-profile-2026",
      issuer: "thinkwork",
      privateKeyPem: key.privateKeyPem,
      signedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-07-06T12:00:00.000Z",
    });

    const result = await verifyDeploymentProfile(
      signed,
      [
        {
          keyId: "deployment-profile-2026",
          issuer: "thinkwork",
          publicKeyPem: key.publicKeyPem,
        },
      ],
      { now: "2026-06-07T12:00:00.000Z" },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe("trusted");
    expect(result.profileSha256).toBe(deploymentProfileSha256(signed));
    expect(result.trust?.publicKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes canonical profile JSON with SHA-256", () => {
    const profile = baseProfile();
    const expected = createHash("sha256")
      .update(deploymentProfileCanonicalJson(profile))
      .digest("hex");

    expect(deploymentProfileSha256(profile)).toBe(expected);
  });

  it("rejects missing required fields before OAuth can trust the profile", () => {
    const profile = { ...baseProfile(), cognitoClientId: "" };

    const result = assessDeploymentProfile(profile, { allowUnsigned: true });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("missing_required_field");
    expect(result.issues.map((issue) => issue.field)).toContain(
      "cognitoClientId",
    );
  });

  it("reports malformed JSON without throwing", () => {
    const result = parseDeploymentProfileJson("{nope");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("malformed_json");
    expect(result.profile).toBeNull();
  });

  it("rejects unsupported schema versions", () => {
    const result = assessDeploymentProfile({
      ...baseProfile(),
      schemaVersion: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported_schema");
  });

  it("treats unsigned profiles as blocked unless the development fallback is allowed", () => {
    const blocked = assessDeploymentProfile(baseProfile());
    const allowed = assessDeploymentProfile(baseProfile(), {
      allowUnsigned: true,
    });

    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe("unsigned");
    expect(allowed.ok).toBe(true);
    expect(allowed.status).toBe("unsigned");
  });

  it("rejects unknown signing keys", async () => {
    const key = testKeyPair();
    const signed = await signDeploymentProfile({
      profile: baseProfile(),
      keyId: "unknown-key",
      issuer: "thinkwork",
      privateKeyPem: key.privateKeyPem,
      signedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-07-06T12:00:00.000Z",
    });

    const result = await verifyDeploymentProfile(signed, [], {
      now: "2026-06-07T12:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unknown_key");
  });

  it("rejects invalid signatures without trusting endpoint metadata", async () => {
    const key = testKeyPair();
    const signed = await signDeploymentProfile({
      profile: baseProfile(),
      keyId: "deployment-profile-2026",
      issuer: "thinkwork",
      privateKeyPem: key.privateKeyPem,
      signedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-07-06T12:00:00.000Z",
    });
    const tampered = {
      ...signed,
      signature: {
        ...signed.signature!,
        signature: `${signed.signature!.signature.slice(0, -4)}abcd`,
      },
    };

    const result = await verifyDeploymentProfile(
      tampered,
      [
        {
          keyId: "deployment-profile-2026",
          issuer: "thinkwork",
          publicKeyPem: key.publicKeyPem,
        },
      ],
      { now: "2026-06-07T12:00:00.000Z" },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("invalid_signature");
  });

  it("rejects endpoint changes that no longer match the signed digest", async () => {
    const key = testKeyPair();
    const signed = await signDeploymentProfile({
      profile: baseProfile(),
      keyId: "deployment-profile-2026",
      issuer: "thinkwork",
      privateKeyPem: key.privateKeyPem,
      signedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-07-06T12:00:00.000Z",
    });

    const result = assessDeploymentProfile({
      ...signed,
      apiUrl: "https://evil.example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("endpoint_mismatch");
  });

  it("requires TLS URLs while allowing localhost only for explicit development fallback", () => {
    const profile = {
      ...baseProfile(),
      spacesUrl: "http://localhost:5174",
      appsyncWsUrl: "ws://localhost:5174/graphql",
    };

    expect(
      assessDeploymentProfile(profile, { allowUnsigned: true }).status,
    ).toBe("malformed_url");
    expect(
      assessDeploymentProfile(profile, {
        allowUnsigned: true,
        allowHttpLocalhost: true,
      }).ok,
    ).toBe(true);
  });

  it("can reject stale profile exports when a max age is configured", () => {
    const result = assessDeploymentProfile(baseProfile(), {
      allowUnsigned: true,
      now: "2026-07-06T12:00:00.000Z",
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("expired");
  });

  it("maps a validated profile to runtime endpoint config", () => {
    expect(profileToRuntimeConfig(baseProfile())).toMatchObject({
      deploymentId: "tw-customer-dev",
      displayName: "Acme ThinkWork",
      graphqlUrl: "https://appsync.example.com/graphql",
      graphqlWsUrl: "wss://appsync.example.com/graphql",
      cognitoDomain: "https://auth.example.com",
      cognitoClientId: "client-123",
    });
  });
});
