import { describe, expect, it } from "vitest";

import {
  buildTenantEntraConnectionMetadata,
  buildTenantEntraProviderName,
  buildTenantEntraSecretName,
  buildEnterpriseIdentityProviderPlan,
  parseIdentityProviderType,
} from "../src/commands/enterprise/identity-provider.js";
import {
  buildIdentityProviderControllerInput,
  writeTenantEntraSecret,
  type AwsExecutor,
} from "../src/commands/enterprise/identity-provider-command.js";

const SAML_XML = `<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com/saml" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <IDPSSODescriptor>
    <KeyDescriptor>
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data><X509Certificate>MIIDexample</X509Certificate></X509Data>
      </KeyInfo>
    </KeyDescriptor>
  </IDPSSODescriptor>
</EntityDescriptor>`;

describe("enterprise identity provider bootstrap validation", () => {
  it("builds a secret-free revisioned controller operation", () => {
    const directoryId = "00000000-0000-4000-8000-000000000123";
    const connection = buildTenantEntraConnectionMetadata({
      directoryId,
      thinkworkTenantId: "019f762b-683c-7153-acff-24ee932d73f6",
      clientId: "entra-client-id",
      clientSecretRef:
        `arn:aws:secretsmanager:us-east-1:123456789012:` +
        `secret:thinkwork/dev/auth/entra/${directoryId}-ABC123`,
      displayName: "Microsoft",
      label: "Acme",
      hostnames: ["Login.Acme.Example", "login.acme.example"],
    });
    const input = buildIdentityProviderControllerInput({
      prior: {
        customerName: "Acme",
        environmentName: "dev",
        awsAccountId: "123456789012",
        awsRegion: "us-east-1",
        availabilityZones: ["us-east-1a", "us-east-1b"],
        evidenceBucket: "thinkwork-dev-evidence",
        releaseVersion: "v1.2.3",
        releaseManifestUrl: "https://releases.example/v1.2.3.json",
        releaseManifestSha256: "a".repeat(64),
      },
      action: "create",
      connection,
      desiredRevision: 4,
      sessionId: "019f762b-683c-7153-acff-24ee932d73f6",
    });

    expect(input).toEqual(
      expect.objectContaining({
        action: "update",
        releaseVersion: "v1.2.3",
        operation: expect.objectContaining({
          kind: "identity_provider",
          action: "create",
          revision: 5,
          expectedPreviousRevision: 4,
          connection,
        }),
      }),
    );
    expect(JSON.stringify(input)).not.toContain("tenant-super-secret");
  });

  it("writes tenant Entra credentials through stdin and never argv", () => {
    const calls: Array<{ args: string[]; input?: unknown }> = [];
    const aws: AwsExecutor = {
      read(args) {
        calls.push({ args });
        throw new Error("not found");
      },
      writeJson(args, input) {
        calls.push({ args, input });
        return (
          "arn:aws:secretsmanager:us-east-1:123456789012:" +
          "secret:thinkwork/dev/auth/entra/00000000-0000-4000-8000-000000000123-ABC123"
        );
      },
    };

    const arn = writeTenantEntraSecret(
      {
        stage: "dev",
        directoryId: "00000000-0000-4000-8000-000000000123",
        clientId: "entra-client-id",
        clientSecret: "tenant-super-secret",
      },
      aws,
    );

    expect(arn).toMatch(/^arn:aws:secretsmanager:/);
    expect(calls.some(({ args }) => args.includes("file:///dev/stdin"))).toBe(
      true,
    );
    expect(calls.map(({ args }) => args.join(" ")).join("\n")).not.toContain(
      "tenant-super-secret",
    );
    expect(JSON.stringify(calls.map(({ input }) => input))).toContain(
      "tenant-super-secret",
    );
  });

  it("stages a rotated credential without replacing AWSCURRENT before reconciliation", () => {
    const calls: Array<{ args: string[]; input?: unknown }> = [];
    const existingArn =
      "arn:aws:secretsmanager:us-east-1:123456789012:" +
      "secret:thinkwork/dev/auth/entra/00000000-0000-4000-8000-000000000123-ABC123";
    const aws: AwsExecutor = {
      read(args) {
        calls.push({ args });
        return existingArn;
      },
      writeJson(args, input) {
        calls.push({ args, input });
        return existingArn;
      },
    };

    writeTenantEntraSecret(
      {
        stage: "dev",
        directoryId: "00000000-0000-4000-8000-000000000123",
        clientId: "entra-client-id",
        clientSecret: "rotated-secret",
        versionStage: "AWSPENDING",
      },
      aws,
    );

    expect(calls[1]?.input).toMatchObject({
      SecretId: existingArn,
      VersionStages: ["AWSPENDING"],
    });
    expect(calls[1]?.input).not.toMatchObject({
      VersionStages: ["AWSCURRENT"],
    });
  });

  it("builds deterministic tenant-Entra safe metadata without retaining its secret", () => {
    const tenantId = "00000000-0000-4000-8000-000000000123";
    const plan = buildEnterpriseIdentityProviderPlan({
      type: "entra",
      tenantId,
      clientId: "entra-client-id",
      clientSecret: "tenant-super-secret",
    });

    expect(plan).toEqual(
      expect.objectContaining({
        type: "entra",
        providerName: buildTenantEntraProviderName(tenantId),
        clientId: "entra-client-id",
        tenantId,
        connectionKey: `microsoft:tenant:${tenantId}`,
        issuerUrl: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        attributeMapping: expect.objectContaining({
          username: "sub",
          tenantId: "tid",
          objectId: "oid",
        }),
      }),
    );
    expect(plan?.providerName).toMatch(/^Entra_[a-f0-9]{16}_[a-f0-9]{8}$/);
    expect(buildTenantEntraSecretName("dev", tenantId)).toBe(
      `thinkwork/dev/auth/entra/${tenantId}`,
    );
    expect(JSON.stringify(plan)).not.toContain("tenant-super-secret");
  });

  it("rejects shared or malformed Microsoft authorities as tenant Entra", () => {
    for (const tenantId of [
      "common",
      "organizations",
      "consumers",
      "not-a-guid",
    ]) {
      expect(() =>
        buildEnterpriseIdentityProviderPlan({
          type: "entra",
          tenantId,
          clientId: "client",
          clientSecret: "secret",
        }),
      ).toThrow(/tenant ID must be a GUID/);
    }
  });
  it("builds a sanitized Google plan without exposing the client secret", () => {
    const plan = buildEnterpriseIdentityProviderPlan({
      type: "google",
      clientId: "google-client",
      clientSecret: "super-secret",
    });

    expect(plan).toEqual(
      expect.objectContaining({
        type: "google",
        providerName: "Google",
        issuerUrl: "https://accounts.google.com",
        secretRequired: true,
      }),
    );
    expect(JSON.stringify(plan)).not.toContain("super-secret");
  });

  it("validates OIDC provider input and unsafe metadata endpoints", () => {
    const plan = buildEnterpriseIdentityProviderPlan({
      type: "oidc",
      providerName: "AcmeOIDC",
      clientId: "client",
      clientSecret: "secret",
      issuerUrl: "https://login.example.com",
      scopes: ["openid", "email"],
    });

    expect(plan).toEqual(
      expect.objectContaining({
        type: "oidc",
        providerName: "AcmeOIDC",
        issuerUrl: "https://login.example.com/",
        scopes: ["openid", "email"],
      }),
    );

    expect(() =>
      buildEnterpriseIdentityProviderPlan({
        type: "oidc",
        providerName: "AcmeOIDC",
        clientId: "client",
        clientSecret: "secret",
      }),
    ).toThrow(/issuer-url or --idp-discovery-url/);

    expect(() =>
      buildEnterpriseIdentityProviderPlan({
        type: "oidc",
        providerName: "AcmeOIDC",
        clientId: "client",
        clientSecret: "secret",
        discoveryUrl: "https://169.254.169.254/latest/meta-data",
      }),
    ).toThrow(/private networks/);
  });

  it("validates SAML metadata without storing raw XML", () => {
    const plan = buildEnterpriseIdentityProviderPlan({
      type: "saml",
      providerName: "AcmeSAML",
      metadataXml: SAML_XML,
      entityId: "https://idp.example.com/saml",
      idpIdentifiers: ["example.com"],
    });

    expect(plan).toEqual(
      expect.objectContaining({
        type: "saml",
        providerName: "AcmeSAML",
        entityId: "https://idp.example.com/saml",
        metadataXmlSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(plan)).not.toContain("<EntityDescriptor");
  });

  it("rejects unsafe SAML metadata", () => {
    expect(() =>
      buildEnterpriseIdentityProviderPlan({
        type: "saml",
        providerName: "AcmeSAML",
        metadataUrl: "https://127.0.0.1/metadata.xml",
      }),
    ).toThrow(/private networks/);

    expect(() =>
      buildEnterpriseIdentityProviderPlan({
        type: "saml",
        providerName: "AcmeSAML",
        metadataXml: `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${SAML_XML}`,
      }),
    ).toThrow(/DOCTYPE or ENTITY/);

    expect(() =>
      buildEnterpriseIdentityProviderPlan({
        type: "saml",
        providerName: "AcmeSAML",
        metadataXml: "x".repeat(256 * 1024 + 1),
      }),
    ).toThrow(/256 KiB/);

    expect(() =>
      buildEnterpriseIdentityProviderPlan({
        type: "saml",
        providerName: "AcmeSAML",
        metadataXml: SAML_XML,
        entityId: "https://other.example.com/saml",
      }),
    ).toThrow(/entityID/);
  });

  it("parses provider type names", () => {
    expect(parseIdentityProviderType("OIDC")).toBe("oidc");
    expect(parseIdentityProviderType("ENTRA")).toBe("entra");
    expect(parseIdentityProviderType(undefined)).toBeUndefined();
    expect(() => parseIdentityProviderType("ldap")).toThrow(
      /Invalid identity provider/,
    );
  });
});
