import type {
  SettingsMyPluginActivationsQuery,
  SettingsPluginCatalogQuery,
  SettingsPluginInstallsQuery,
} from "@/gql/graphql";

export type PluginCatalogEntry =
  SettingsPluginCatalogQuery["pluginCatalog"][number];

export type PluginCatalogVersion = PluginCatalogEntry["versions"][number];

export type PluginInstall =
  SettingsPluginInstallsQuery["pluginInstalls"][number];

export type PluginComponent = PluginInstall["components"][number];

export type PluginActivation =
  SettingsMyPluginActivationsQuery["myPluginActivations"][number];

/** Human label for a plugin install state. */
export function installStateLabel(state: string): string {
  switch (state) {
    case "installing":
      return "Installing";
    case "awaiting_approval":
      return "Awaiting approval";
    case "installed":
      return "Installed";
    case "partially_installed":
      return "Partially installed";
    case "failed":
      return "Failed";
    case "uninstalling":
      return "Uninstalling";
    default:
      return state;
  }
}

/** Tailwind classes for the install state chip — Badge variant="outline". */
export function installStateChipClassName(state: string): string | undefined {
  switch (state) {
    case "installed":
      return "border-emerald-500/40 text-emerald-400";
    case "failed":
      return "border-destructive/40 text-destructive";
    case "partially_installed":
    case "awaiting_approval":
      return "border-amber-500/40 text-amber-500";
    default:
      return undefined;
  }
}

/** Human label for a plugin component state. */
export function componentStateLabel(state: string): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "provisioned":
      return "Provisioned";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}

/** Tailwind classes for a component state chip — Badge variant="outline". */
export function componentStateChipClassName(state: string): string | undefined {
  switch (state) {
    case "provisioned":
      return "border-emerald-500/40 text-emerald-400";
    case "failed":
      return "border-destructive/40 text-destructive";
    default:
      return undefined;
  }
}

/** Human label for a component type. */
export function componentTypeLabel(type: string): string {
  switch (type) {
    case "mcp-server":
      return "MCP server";
    case "skills":
      return "Skills";
    case "infrastructure":
      return "Infrastructure";
    case "ui-surface":
      return "UI surface";
    case "auth-provider":
      return "Auth provider";
    default:
      return type;
  }
}

/**
 * Scopes required by `nextVersion` that the currently pinned version did not
 * request. Non-empty means upgrading will broaden the OAuth consent, so
 * activated users will have to re-authenticate.
 */
export function broadenedScopes(
  entry: Pick<PluginCatalogEntry, "versions">,
  currentVersion: string,
  nextVersion: string,
): string[] {
  const current =
    entry.versions.find((v) => v.version === currentVersion)
      ?.requiredOauthScopes ?? [];
  const next =
    entry.versions.find((v) => v.version === nextVersion)
      ?.requiredOauthScopes ?? [];
  return next.filter((scope) => !current.includes(scope));
}
