import { describe, expect, it } from "vitest";

import {
  buildEnterpriseIdentityProviderPlan,
  parseIdentityProviderType,
} from "../src/commands/enterprise/identity-provider.js";

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
    expect(parseIdentityProviderType(undefined)).toBeUndefined();
    expect(() => parseIdentityProviderType("ldap")).toThrow(
      /Invalid identity provider/,
    );
  });
});
