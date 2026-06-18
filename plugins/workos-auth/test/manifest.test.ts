import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type AuthProviderComponent,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { workosAuthPluginPackage } from "../src";
import { workosAuthManifest } from "../src/manifest";
import {
  WORKOS_AUTH_COGNITO_IDP_NAME,
  WORKOS_AUTH_PROVIDER_COMPONENT_KEY,
  WORKOS_AUTH_SETTINGS_SURFACE,
  workosAuthConfigFields,
  workosAuthPublicOptions,
} from "../src/provider-contract";

function authProviderComponent(): AuthProviderComponent {
  const component = workosAuthManifest.versions[0].components.find(
    (candidate) => candidate.type === "auth-provider",
  );
  if (component?.type !== "auth-provider") {
    throw new Error("WorkOS Auth manifest is missing auth-provider component");
  }
  return component;
}

describe("WorkOS Auth plugin manifest", () => {
  it("validates as an auth-provider plugin with a settings surface", () => {
    const validated = validatePluginManifest(workosAuthManifest);

    expect(validated.pluginKey).toBe("workos-auth");
    expect(validated.displayName).toBe("WorkOS Auth");
    expect(validated.versions[0].requiredOauthScopes).toEqual([]);
    expect(validated.versions[0].components.map((component) => component.type))
      .toEqual(["auth-provider", "ui-surface"]);
  });

  it("declares the U1-approved single SSO fallback instead of provider buttons", () => {
    const component = authProviderComponent();

    expect(component).toMatchObject({
      type: "auth-provider",
      key: WORKOS_AUTH_PROVIDER_COMPONENT_KEY,
      provider: "workos",
      settingsSurface: WORKOS_AUTH_SETTINGS_SURFACE,
      cognitoIdentityProviderName: WORKOS_AUTH_COGNITO_IDP_NAME,
    });
    expect(component.publicOptions).toEqual(workosAuthPublicOptions);
    expect(component.publicOptions).toEqual([
      {
        key: "sso",
        displayName: "Continue with SSO",
        providerSpecific: false,
        recommended: true,
      },
    ]);
  });

  it("models secrets as secret references, never manifest values", () => {
    expect(workosAuthConfigFields).toEqual([
      {
        key: "issuerUrl",
        displayName: "WorkOS AuthKit issuer URL",
        required: true,
        storage: "metadata",
      },
      {
        key: "clientId",
        displayName: "WorkOS OAuth client ID",
        required: true,
        storage: "metadata",
      },
      {
        key: "clientSecret",
        displayName: "WorkOS OAuth client secret",
        required: true,
        storage: "secret-ref",
      },
    ]);
    expect(JSON.stringify(workosAuthManifest)).not.toMatch(
      /client_secret|sk_|secretValue|currentValue/,
    );
  });

  it("defines a first-party package boundary under plugins/workos-auth", () => {
    const defined = defineFirstPartyPluginPackage(workosAuthPluginPackage);

    expect(defined.packageKey).toBe("workos-auth");
    expect(defined.sourceRoot).toBe("plugins/workos-auth");
    expect(defined.compatibilityLinks).toEqual([]);
  });
});
