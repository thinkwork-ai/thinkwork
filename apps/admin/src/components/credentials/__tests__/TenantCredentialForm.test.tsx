import { describe, expect, it } from "vitest";
import { TenantCredentialKind } from "@/gql/graphql";
import {
  emptySecretFields,
  parseOptionalJsonObject,
  secretPayloadForKind,
} from "@/components/credentials/TenantCredentialForm";

describe("TenantCredentialForm helpers", () => {
  it("builds a SOAP partner secret payload", () => {
    expect(
      secretPayloadForKind(TenantCredentialKind.SoapPartner, {
        apiUrl: "https://pdi.example.test/soap",
        username: "operator",
        password: "secret",
        partnerId: "partner-123",
      }),
    ).toEqual({
      apiUrl: "https://pdi.example.test/soap",
      username: "operator",
      password: "secret",
      partnerId: "partner-123",
    });
  });

  it("rejects missing required fields before submitting", () => {
    expect(() =>
      secretPayloadForKind(TenantCredentialKind.BasicAuth, {
        username: "operator",
        password: "",
      }),
    ).toThrow("Password");
  });

  it("validates JSON object fields", () => {
    expect(parseOptionalJsonObject('{"env":"prod"}', "Metadata JSON")).toEqual({
      env: "prod",
    });
    expect(() => parseOptionalJsonObject("[1]", "Metadata JSON")).toThrow(
      "Metadata JSON must be a JSON object.",
    );
  });

  it("resets secret fields to empty values", () => {
    expect(emptySecretFields(TenantCredentialKind.BasicAuth)).toEqual({
      username: "",
      password: "",
    });
    expect(emptySecretFields(TenantCredentialKind.Json)).toEqual({ json: "{}" });
  });
});
