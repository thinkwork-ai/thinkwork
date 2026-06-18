import type { PluginManifest } from "@thinkwork/plugin-catalog/contracts";

import {
  WORKOS_AUTH_COGNITO_IDP_NAME,
  WORKOS_AUTH_PROVIDER_COMPONENT_KEY,
  WORKOS_AUTH_SETTINGS_SURFACE,
  workosAuthConfigFields,
  workosAuthPublicOptions,
} from "./provider-contract";

export const workosAuthManifest = {
  pluginKey: "workos-auth",
  displayName: "WorkOS Auth",
  description:
    "WorkOS-backed SSO broker that federates through Cognito while keeping Cognito as ThinkWork's final session issuer.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "auth-provider",
          key: WORKOS_AUTH_PROVIDER_COMPONENT_KEY,
          displayName: "WorkOS Cognito federation",
          provider: "workos",
          settingsSurface: WORKOS_AUTH_SETTINGS_SURFACE,
          cognitoIdentityProviderName: WORKOS_AUTH_COGNITO_IDP_NAME,
          configFields: workosAuthConfigFields,
          publicOptions: workosAuthPublicOptions,
        },
        {
          type: "ui-surface",
          key: "settings",
          displayName: "WorkOS Auth settings",
          intendedMount: WORKOS_AUTH_SETTINGS_SURFACE,
        },
      ],
    },
  ],
} satisfies PluginManifest;
