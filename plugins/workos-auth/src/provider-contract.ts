import type {
  AuthProviderConfigField,
  AuthProviderPublicOption,
} from "@thinkwork/plugin-catalog/contracts";

export const WORKOS_AUTH_PROVIDER_COMPONENT_KEY = "workos-auth" as const;
export const WORKOS_AUTH_SETTINGS_SURFACE =
  "settings.plugins.workos-auth" as const;
export const WORKOS_AUTH_COGNITO_IDP_NAME = "WorkOSAuth" as const;

export const workosAuthConfigFields = [
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
] satisfies AuthProviderConfigField[];

export const workosAuthPublicOptions = [
  {
    key: "sso",
    displayName: "Continue with SSO",
    providerSpecific: false,
    recommended: true,
  },
] satisfies AuthProviderPublicOption[];
