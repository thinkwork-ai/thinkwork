import {
  SLUG_RE,
  validatePluginManifest,
  type PluginManifest,
} from "./contracts";

export const PLUGIN_PACKAGE_SOURCE_KINDS = [
  "manifest",
  "skills",
  "terraform",
  "deployment",
  "runtime",
  "api",
  "web",
  "smoke",
  "docs",
  "tests",
] as const;

export type PluginPackageSourceKind =
  (typeof PLUGIN_PACKAGE_SOURCE_KINDS)[number];

export interface PluginPackageOwnedSource {
  /** Source category this plugin package owns. */
  kind: PluginPackageSourceKind;
  /** Repo-relative path. Must be inside the plugin source root. */
  path: string;
  /** Human-readable summary of what the path owns. */
  description: string;
}

export interface PluginPackageCompatibilityLink {
  /** Repo-relative legacy path outside the plugin package. */
  path: string;
  /** Why this path has not moved yet. */
  reason: string;
  /** Removal gate, usually the implementation unit or release pass. */
  removal: string;
}

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
  /** Package-owned source descriptors used by docs, builders, and enforcement. */
  ownedSources: readonly PluginPackageOwnedSource[];
  /** Temporary legacy paths that still carry plugin-specific source. */
  compatibilityLinks: readonly PluginPackageCompatibilityLink[];
}

export interface FirstPartyPluginPackageInput {
  packageKey: string;
  sourceRoot: `plugins/${string}`;
  manifest: unknown;
  ownedSources?: readonly PluginPackageOwnedSource[];
  compatibilityLinks?: readonly PluginPackageCompatibilityLink[];
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

  const ownedSources = validateOwnedSources(value, value.packageKey);
  const compatibilityLinks = validateCompatibilityLinks(
    value,
    value.packageKey,
  );

  return { ...value, manifest, ownedSources, compatibilityLinks };
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PluginPackageError(`${label} must be a non-empty string`);
  }
}

function validateOwnedSources(
  value: FirstPartyPluginPackageInput,
  packageKey: string,
): PluginPackageOwnedSource[] {
  if (value.ownedSources === undefined) return [];
  if (!Array.isArray(value.ownedSources)) {
    throw new PluginPackageError(
      `plugin package ${packageKey}: ownedSources must be an array`,
    );
  }

  return value.ownedSources.map((source, index) => {
    const prefix = `plugin package ${packageKey}: ownedSources[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new PluginPackageError(`${prefix} must be an object`);
    }
    if (!PLUGIN_PACKAGE_SOURCE_KINDS.includes(source.kind)) {
      throw new PluginPackageError(
        `${prefix}.kind must be one of ${PLUGIN_PACKAGE_SOURCE_KINDS.join(", ")}`,
      );
    }
    requireString(source.path, `${prefix}.path`);
    requireString(source.description, `${prefix}.description`);
    if (!source.path.startsWith(`${value.sourceRoot}/`)) {
      throw new PluginPackageError(
        `${prefix}.path must live under ${value.sourceRoot}/`,
      );
    }
    return source;
  });
}

function validateCompatibilityLinks(
  value: FirstPartyPluginPackageInput,
  packageKey: string,
): PluginPackageCompatibilityLink[] {
  if (value.compatibilityLinks === undefined) return [];
  if (!Array.isArray(value.compatibilityLinks)) {
    throw new PluginPackageError(
      `plugin package ${packageKey}: compatibilityLinks must be an array`,
    );
  }

  return value.compatibilityLinks.map((link, index) => {
    const prefix = `plugin package ${packageKey}: compatibilityLinks[${index}]`;
    if (!link || typeof link !== "object" || Array.isArray(link)) {
      throw new PluginPackageError(`${prefix} must be an object`);
    }
    requireString(link.path, `${prefix}.path`);
    requireString(link.reason, `${prefix}.reason`);
    requireString(link.removal, `${prefix}.removal`);
    if (link.path.startsWith(`${value.sourceRoot}/`)) {
      throw new PluginPackageError(
        `${prefix}.path should describe legacy source outside ${value.sourceRoot}/`,
      );
    }
    return link;
  });
}
