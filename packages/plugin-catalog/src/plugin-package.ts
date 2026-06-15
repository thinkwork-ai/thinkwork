import {
  SLUG_RE,
  validatePluginManifest,
  type PluginManifest,
} from "./contracts";

export interface FirstPartyPluginPackage {
  /**
   * Stable package key. This should match the owning folder name under
   * `plugins/<packageKey>/` and the manifest's `pluginKey`.
   */
  packageKey: string;
  /** Repo-relative path to the plugin package root. */
  sourceRoot: `plugins/${string}`;
  /** Published catalog manifest owned by this plugin package. */
  manifest: PluginManifest;
}

export interface FirstPartyPluginPackageInput {
  packageKey: string;
  sourceRoot: `plugins/${string}`;
  manifest: unknown;
}

export class PluginPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginPackageError";
  }
}

export function defineFirstPartyPluginPackage(
  value: FirstPartyPluginPackageInput,
): FirstPartyPluginPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PluginPackageError("Plugin package must be an object");
  }
  requireString(value.packageKey, "packageKey");
  if (!SLUG_RE.test(value.packageKey)) {
    throw new PluginPackageError(
      `packageKey "${value.packageKey}" must match ${SLUG_RE.source}`,
    );
  }
  requireString(value.sourceRoot, "sourceRoot");
  if (value.sourceRoot !== `plugins/${value.packageKey}`) {
    throw new PluginPackageError(
      `plugin package ${value.packageKey}: sourceRoot must be plugins/${value.packageKey}`,
    );
  }

  const manifest = validatePluginManifest(value.manifest);
  if (manifest.pluginKey !== value.packageKey) {
    throw new PluginPackageError(
      `plugin package ${value.packageKey}: manifest pluginKey must match packageKey`,
    );
  }

  return { ...value, manifest };
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PluginPackageError(`${label} must be a non-empty string`);
  }
}
