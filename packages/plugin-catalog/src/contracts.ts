/**
 * Plugin manifest contracts.
 *
 * A plugin is a versioned package described by a manifest declaring identity
 * and components. Exactly four component types exist in v1:
 *
 *   - `mcp-server`     — a hosted MCP endpoint the agent dispatches to
 *   - `skills`         — bundled skill folders seeded into the tenant catalog
 *   - `infrastructure` — a managed-app Terraform deployment
 *   - `ui-surface`     — declared-only in v1 (identity + intended mount)
 *
 * This module is pure: types + validation only. No DB, GraphQL, or AWS
 * imports — the SSM-backed catalog verification wrapper lives in
 * `packages/api`.
 */

// Mirrors packages/api/src/types/catalog-skill.ts SLUG_RE — plugin skill
// slugs land in the same tenant skill-catalog namespace, so they must obey
// the same shape. Namespacing is by hyphen convention (`lastmile--crm-basics`),
// never slashes.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Full semver 2.0.0 shape including prerelease/build metadata.
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const PLUGIN_COMPONENT_TYPES = [
  "mcp-server",
  "skills",
  "infrastructure",
  "ui-surface",
] as const;

export type PluginComponentType = (typeof PLUGIN_COMPONENT_TYPES)[number];

export type McpServerAuth =
  | {
      mode: "oauth";
      /** Authorization-server reference (the plugin-wide auth domain). */
      authDomain: string;
      /** RFC 8707 resource indicator the minted token must be bound to. */
      resourceIndicator: string;
    }
  | {
      /**
       * Per-instance OAuth (e.g. Twenty CRM): the server endpoint is
       * tenant-specific (`endpointFrom`), and both the resource indicator
       * AND the authorization server are derived from the RESOLVED
       * endpoint at provision/activation time — the resource indicator is
       * the resolved endpoint URL, and the auth domain comes from the
       * endpoint's RFC 9728 protected-resource metadata. Requires
       * `endpointFrom` on the component.
       */
      mode: "oauth-per-instance";
    }
  | {
      /**
       * User-provided HTTP headers (e.g. Plane PAT mode). Activation stores
       * the caller's values as a per-user plugin secret, then dispatch emits
       * only these declared headers to the MCP transport. Never use this for
       * Authorization-bearing OAuth; OAuth must stay in the handle-shaped
       * bearer path.
       */
      mode: "user-provided-headers";
      /**
       * Optional first-class bearer token credential to send as
       * `Authorization: Bearer <value>`, alongside any declared headers.
       * Use this when the MCP transport/framework expects Authorization as
       * its auth token path but still needs extra per-user headers.
       */
      bearer?: McpUserProvidedBearer;
      headers: McpUserProvidedHeader[];
    }
  | { mode: "none" };

export interface McpUserProvidedBearer {
  /** Activation input key whose value supplies the bearer token. */
  credentialKey: string;
  /** Human label for activation UI/operator docs. */
  displayName: string;
  /** Marks secret fields for UI copy; values are always stored as secrets. */
  secret?: boolean;
}

export interface McpUserProvidedHeader {
  /** HTTP header name to send to the MCP server, e.g. `x-api-key`. */
  name: string;
  /** Activation input key whose value supplies this header. */
  credentialKey: string;
  /** Human label for activation UI/operator docs. */
  displayName: string;
  /** Marks secret fields for UI copy; values are always stored as secrets. */
  secret?: boolean;
}

/**
 * The ONE allowed endpoint indirection (plan 2026-06-12-001 U10): a
 * manifest cannot carry a tenant-specific URL, so the MCP handler resolves
 * the endpoint at provision time from the tenant's `managed_applications`
 * row for `managedApp` — `desired_config[configKey]` holds the
 * application's public URL (for Twenty, `publicUrl`, which the adapter
 * echoes verbatim as the `twenty_url` Terraform output), and `path`
 * replaces the URL path (e.g. `/mcp`).
 */
export interface McpEndpointFrom {
  /** Managed-app adapter key whose managed_applications row carries the URL. */
  managedApp: string;
  /** `desired_config` key holding the application's public http(s) URL. */
  configKey: string;
  /** Replacement URL path for the MCP endpoint (must start with `/`). */
  path?: string;
}

export interface McpServerComponent {
  type: "mcp-server";
  key: string;
  displayName: string;
  description?: string;
  /** Static endpoint URL. Exactly one of `endpointUrl` / `endpointFrom`. */
  endpointUrl?: string;
  /** Provision-time endpoint resolution from a managed-app row. */
  endpointFrom?: McpEndpointFrom;
  auth: McpServerAuth;
  /** Optional human notes about the tools the server exposes. */
  toolNotes?: string[];
}

export interface SkillSupportingFile {
  /** Path relative to the skill folder (e.g. `references/guide.md`). */
  path: string;
  content: string;
}

export interface PluginSkillSource {
  /**
   * Namespaced slug satisfying SLUG_RE — hyphen-namespaced like
   * `lastmile--crm-basics`, never slash-delimited. Seeds into
   * `tenants/<tenant-slug>/skill-catalog/<slug>/`.
   */
  slug: string;
  /** Full SKILL.md content (frontmatter + body). */
  skillMd: string;
  supportingFiles?: SkillSupportingFile[];
}

export interface SkillsComponent {
  type: "skills";
  key: string;
  skills: PluginSkillSource[];
}

export interface TerraformInputSpec {
  description: string;
  /** Terraform type expression, e.g. `string`, `number`, `list(string)`. */
  type: string;
}

export interface InfrastructureComponent {
  type: "infrastructure";
  key: string;
  /** Managed-app adapter key in the deployment-runner registry. */
  managedAppKey: string;
  /** Required Terraform input names → their contract. */
  terraformInputs: Record<string, TerraformInputSpec>;
}

export interface UiSurfaceComponent {
  type: "ui-surface";
  key: string;
  displayName: string;
  /** Intended mount point identity; declared-only in v1, never rendered. */
  intendedMount: string;
}

export type PluginComponent =
  | McpServerComponent
  | SkillsComponent
  | InfrastructureComponent
  | UiSurfaceComponent;

export interface PluginVersion {
  /** Semver string (SEMVER_RE). */
  version: string;
  /** OAuth scopes this version's MCP servers require at activation. */
  requiredOauthScopes: string[];
  components: PluginComponent[];
}

export interface PremiumPluginMetadata {
  /**
   * Stable product/entitlement key used by the premium entitlement layer.
   * Usually matches `pluginKey`, but remains explicit so future paid
   * packages can share or migrate entitlement products deliberately.
   */
  entitlementProductKey: string;
  /** V1 premium plugins install through a ThinkWork-provided one-time key. */
  installKeyRequired: true;
  /** Customer-facing prompt copy shown when the tenant lacks entitlement. */
  installKeyPrompt: string;
}

export interface PluginManifest {
  /** Plugin key satisfying SLUG_RE; unique within a catalog. */
  pluginKey: string;
  displayName: string;
  description: string;
  /** Present for paid/key-gated plugins. Omitted for free/included plugins. */
  premium?: PremiumPluginMetadata;
  versions: PluginVersion[];
}

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginManifestError";
  }
}

export function validatePluginManifest(value: unknown): PluginManifest {
  const manifest = value as Partial<PluginManifest>;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new PluginManifestError("Plugin manifest must be an object");
  }
  requireString(manifest.pluginKey, "pluginKey");
  if (!SLUG_RE.test(manifest.pluginKey)) {
    throw new PluginManifestError(
      `pluginKey "${manifest.pluginKey}" must match ${SLUG_RE.source}`,
    );
  }
  requireString(manifest.displayName, "displayName");
  requireString(manifest.description, "description");
  if (manifest.premium !== undefined) {
    validatePremiumPluginMetadata(manifest.premium, manifest.pluginKey);
  }
  if (!Array.isArray(manifest.versions) || manifest.versions.length === 0) {
    throw new PluginManifestError(
      `plugin ${manifest.pluginKey}: versions must be a non-empty array`,
    );
  }
  const seenVersions = new Set<string>();
  for (const version of manifest.versions) {
    validatePluginVersion(version, manifest.pluginKey);
    if (seenVersions.has(version.version)) {
      throw new PluginManifestError(
        `plugin ${manifest.pluginKey}: duplicate version ${version.version}`,
      );
    }
    seenVersions.add(version.version);
  }
  return manifest as PluginManifest;
}

function validatePremiumPluginMetadata(
  value: unknown,
  pluginKey: string,
): void {
  const premium = value as Partial<PremiumPluginMetadata>;
  const prefix = `plugin ${pluginKey}: premium`;
  if (!premium || typeof premium !== "object" || Array.isArray(premium)) {
    throw new PluginManifestError(`${prefix} must be an object`);
  }
  requireString(
    premium.entitlementProductKey,
    `${prefix}.entitlementProductKey`,
  );
  if (!SLUG_RE.test(premium.entitlementProductKey)) {
    throw new PluginManifestError(
      `${prefix}.entitlementProductKey "${premium.entitlementProductKey}" must match ${SLUG_RE.source}`,
    );
  }
  if (premium.installKeyRequired !== true) {
    throw new PluginManifestError(`${prefix}.installKeyRequired must be true`);
  }
  requireString(premium.installKeyPrompt, `${prefix}.installKeyPrompt`);
}

function validatePluginVersion(value: unknown, pluginKey: string): void {
  const version = value as Partial<PluginVersion>;
  if (!version || typeof version !== "object" || Array.isArray(version)) {
    throw new PluginManifestError(
      `plugin ${pluginKey}: each version must be an object`,
    );
  }
  requireString(version.version, `plugin ${pluginKey}: version`);
  if (!SEMVER_RE.test(version.version)) {
    throw new PluginManifestError(
      `plugin ${pluginKey}: version "${version.version}" is not valid semver`,
    );
  }
  const label = `plugin ${pluginKey}@${version.version}`;
  if (
    !Array.isArray(version.requiredOauthScopes) ||
    version.requiredOauthScopes.some(
      (scope) => typeof scope !== "string" || scope.length === 0,
    )
  ) {
    throw new PluginManifestError(
      `${label}: requiredOauthScopes must be an array of non-empty strings`,
    );
  }
  if (!Array.isArray(version.components) || version.components.length === 0) {
    throw new PluginManifestError(
      `${label}: components must be a non-empty array`,
    );
  }

  const seenComponentKeys = new Set<string>();
  const seenSkillSlugs = new Set<string>();
  let hasOauthServer = false;

  for (const component of version.components as Partial<PluginComponent>[]) {
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component)
    ) {
      throw new PluginManifestError(
        `${label}: each component must be an object`,
      );
    }
    if (
      !(PLUGIN_COMPONENT_TYPES as readonly string[]).includes(
        component.type as string,
      )
    ) {
      throw new PluginManifestError(
        `${label}: unknown component type "${String(component.type)}"`,
      );
    }
    requireString(component.key, `${label}: component.key`);
    if (!SLUG_RE.test(component.key)) {
      throw new PluginManifestError(
        `${label}: component key "${component.key}" must match ${SLUG_RE.source}`,
      );
    }
    if (seenComponentKeys.has(component.key)) {
      throw new PluginManifestError(
        `${label}: duplicate component key "${component.key}"`,
      );
    }
    seenComponentKeys.add(component.key);

    switch (component.type) {
      case "mcp-server":
        if (
          validateMcpServerComponent(component as McpServerComponent, label)
        ) {
          hasOauthServer = true;
        }
        break;
      case "skills":
        validateSkillsComponent(
          component as SkillsComponent,
          label,
          seenSkillSlugs,
        );
        break;
      case "infrastructure":
        validateInfrastructureComponent(
          component as InfrastructureComponent,
          label,
        );
        break;
      case "ui-surface":
        validateUiSurfaceComponent(component as UiSurfaceComponent, label);
        break;
    }
  }

  // OAuth servers without declared scopes would mint an unauditable grant —
  // the activation flow needs the scope set up front. Per-instance OAuth
  // servers are exempt: their authorization server (and its supported
  // scopes) are only discoverable per tenant instance, so an empty scope
  // list degrades to the activation flow's default scope set.
  if (hasOauthServer && version.requiredOauthScopes!.length === 0) {
    throw new PluginManifestError(
      `${label}: OAuth mcp-server components require non-empty requiredOauthScopes`,
    );
  }
}

/** Returns true when the component uses static (plugin-wide) OAuth. */
function validateMcpServerComponent(
  component: Partial<McpServerComponent>,
  label: string,
): boolean {
  const prefix = `${label}: mcp-server "${component.key}"`;
  requireString(component.displayName, `${prefix}.displayName`);
  if (
    component.description !== undefined &&
    typeof component.description !== "string"
  ) {
    throw new PluginManifestError(`${prefix}.description must be a string`);
  }
  if (
    (component.endpointUrl === undefined) ===
    (component.endpointFrom === undefined)
  ) {
    throw new PluginManifestError(
      `${prefix} must declare exactly one of endpointUrl / endpointFrom`,
    );
  }
  if (component.endpointUrl !== undefined) {
    requireString(component.endpointUrl, `${prefix}.endpointUrl`);
    requireHttpUrl(component.endpointUrl, `${prefix}.endpointUrl`);
  } else {
    validateEndpointFrom(component.endpointFrom!, prefix);
  }
  if (component.toolNotes !== undefined) {
    if (
      !Array.isArray(component.toolNotes) ||
      component.toolNotes.some((note) => typeof note !== "string")
    ) {
      throw new PluginManifestError(
        `${prefix}.toolNotes must be an array of strings`,
      );
    }
  }
  const auth = component.auth as Partial<McpServerAuth> | undefined;
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
    throw new PluginManifestError(`${prefix}.auth is required`);
  }
  if (auth.mode === "none") return false;
  if (auth.mode === "oauth-per-instance") {
    if (component.endpointFrom === undefined) {
      throw new PluginManifestError(
        `${prefix}.auth.mode "oauth-per-instance" requires endpointFrom (the resolved endpoint anchors the per-instance auth)`,
      );
    }
    return false;
  }
  if (auth.mode === "user-provided-headers") {
    validateUserProvidedHeadersAuth(auth, prefix);
    return false;
  }
  if (auth.mode !== "oauth") {
    throw new PluginManifestError(
      `${prefix}.auth.mode must be "oauth", "oauth-per-instance", "user-provided-headers", or "none"`,
    );
  }
  const oauth = auth as Partial<Extract<McpServerAuth, { mode: "oauth" }>>;
  requireString(oauth.authDomain, `${prefix}.auth.authDomain`);
  requireHttpUrl(oauth.authDomain, `${prefix}.auth.authDomain`);
  requireString(oauth.resourceIndicator, `${prefix}.auth.resourceIndicator`);
  return true;
}

const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CREDENTIAL_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_USER_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);

function validateUserProvidedHeadersAuth(
  auth: Partial<Extract<McpServerAuth, { mode: "user-provided-headers" }>>,
  prefix: string,
): void {
  if (!Array.isArray(auth.headers) || auth.headers.length === 0) {
    throw new PluginManifestError(
      `${prefix}.auth.headers must be a non-empty array`,
    );
  }
  const seenHeaderNames = new Set<string>();
  const seenCredentialKeys = new Set<string>();
  if (auth.bearer !== undefined) {
    const label = `${prefix}.auth.bearer`;
    if (
      !auth.bearer ||
      typeof auth.bearer !== "object" ||
      Array.isArray(auth.bearer)
    ) {
      throw new PluginManifestError(`${label} must be an object`);
    }
    requireString(auth.bearer.credentialKey, `${label}.credentialKey`);
    if (!CREDENTIAL_KEY_RE.test(auth.bearer.credentialKey)) {
      throw new PluginManifestError(
        `${label}.credentialKey "${auth.bearer.credentialKey}" must match ${CREDENTIAL_KEY_RE.source}`,
      );
    }
    seenCredentialKeys.add(auth.bearer.credentialKey);
    requireString(auth.bearer.displayName, `${label}.displayName`);
    if (
      auth.bearer.secret !== undefined &&
      typeof auth.bearer.secret !== "boolean"
    ) {
      throw new PluginManifestError(`${label}.secret must be a boolean`);
    }
  }
  for (const [index, header] of auth.headers.entries()) {
    const label = `${prefix}.auth.headers[${index}]`;
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw new PluginManifestError(`${label} must be an object`);
    }
    requireString(header.name, `${label}.name`);
    if (!HTTP_HEADER_NAME_RE.test(header.name)) {
      throw new PluginManifestError(
        `${label}.name "${header.name}" must be a valid HTTP header name`,
      );
    }
    const normalizedName = header.name.toLowerCase();
    if (FORBIDDEN_USER_HEADER_NAMES.has(normalizedName)) {
      throw new PluginManifestError(
        `${label}.name "${header.name}" is not allowed for user-provided header auth`,
      );
    }
    if (seenHeaderNames.has(normalizedName)) {
      throw new PluginManifestError(
        `${prefix}.auth.headers declares duplicate header "${header.name}"`,
      );
    }
    seenHeaderNames.add(normalizedName);

    requireString(header.credentialKey, `${label}.credentialKey`);
    if (!CREDENTIAL_KEY_RE.test(header.credentialKey)) {
      throw new PluginManifestError(
        `${label}.credentialKey "${header.credentialKey}" must match ${CREDENTIAL_KEY_RE.source}`,
      );
    }
    if (seenCredentialKeys.has(header.credentialKey)) {
      throw new PluginManifestError(
        `${prefix}.auth.headers declares duplicate credentialKey "${header.credentialKey}"`,
      );
    }
    seenCredentialKeys.add(header.credentialKey);

    requireString(header.displayName, `${label}.displayName`);
    if (header.secret !== undefined && typeof header.secret !== "boolean") {
      throw new PluginManifestError(`${label}.secret must be a boolean`);
    }
  }
}

function validateEndpointFrom(
  endpointFrom: Partial<McpEndpointFrom>,
  prefix: string,
): void {
  if (
    !endpointFrom ||
    typeof endpointFrom !== "object" ||
    Array.isArray(endpointFrom)
  ) {
    throw new PluginManifestError(`${prefix}.endpointFrom must be an object`);
  }
  requireString(endpointFrom.managedApp, `${prefix}.endpointFrom.managedApp`);
  if (!SLUG_RE.test(endpointFrom.managedApp)) {
    throw new PluginManifestError(
      `${prefix}.endpointFrom.managedApp "${endpointFrom.managedApp}" must match ${SLUG_RE.source}`,
    );
  }
  requireString(endpointFrom.configKey, `${prefix}.endpointFrom.configKey`);
  if (endpointFrom.path !== undefined) {
    if (
      typeof endpointFrom.path !== "string" ||
      !endpointFrom.path.startsWith("/") ||
      /[?#]/.test(endpointFrom.path)
    ) {
      throw new PluginManifestError(
        `${prefix}.endpointFrom.path must start with "/" and carry no query/fragment`,
      );
    }
  }
}

function validateSkillsComponent(
  component: Partial<SkillsComponent>,
  label: string,
  seenSkillSlugs: Set<string>,
): void {
  const prefix = `${label}: skills "${component.key}"`;
  if (!Array.isArray(component.skills) || component.skills.length === 0) {
    throw new PluginManifestError(`${prefix}.skills must be a non-empty array`);
  }
  for (const skill of component.skills as Partial<PluginSkillSource>[]) {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) {
      throw new PluginManifestError(`${prefix}: each skill must be an object`);
    }
    requireString(skill.slug, `${prefix}: skill.slug`);
    if (!SLUG_RE.test(skill.slug)) {
      throw new PluginManifestError(
        `${prefix}: skill slug "${skill.slug}" must match ${SLUG_RE.source} (hyphen-namespaced, no slashes)`,
      );
    }
    if (seenSkillSlugs.has(skill.slug)) {
      throw new PluginManifestError(
        `${label}: duplicate skill slug "${skill.slug}"`,
      );
    }
    seenSkillSlugs.add(skill.slug);
    requireString(skill.skillMd, `${prefix}: skill "${skill.slug}".skillMd`);
    if (skill.supportingFiles !== undefined) {
      if (!Array.isArray(skill.supportingFiles)) {
        throw new PluginManifestError(
          `${prefix}: skill "${skill.slug}".supportingFiles must be an array`,
        );
      }
      const seenPaths = new Set<string>();
      for (const file of skill.supportingFiles as Partial<SkillSupportingFile>[]) {
        if (!file || typeof file !== "object") {
          throw new PluginManifestError(
            `${prefix}: skill "${skill.slug}" supporting files must be objects`,
          );
        }
        requireString(file.path, `${prefix}: skill "${skill.slug}" file.path`);
        if (
          file.path.startsWith("/") ||
          file.path.includes("\\") ||
          file.path.split("/").includes("..")
        ) {
          throw new PluginManifestError(
            `${prefix}: skill "${skill.slug}" supporting file path "${file.path}" must be folder-relative`,
          );
        }
        if (seenPaths.has(file.path)) {
          throw new PluginManifestError(
            `${prefix}: skill "${skill.slug}" duplicate supporting file path "${file.path}"`,
          );
        }
        seenPaths.add(file.path);
        if (typeof file.content !== "string") {
          throw new PluginManifestError(
            `${prefix}: skill "${skill.slug}" file "${file.path}" content must be a string`,
          );
        }
      }
    }
  }
}

function validateInfrastructureComponent(
  component: Partial<InfrastructureComponent>,
  label: string,
): void {
  const prefix = `${label}: infrastructure "${component.key}"`;
  requireString(component.managedAppKey, `${prefix}.managedAppKey`);
  const inputs = component.terraformInputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    throw new PluginManifestError(
      `${prefix}.terraformInputs must be an object`,
    );
  }
  for (const [name, spec] of Object.entries(inputs)) {
    if (name.length === 0) {
      throw new PluginManifestError(
        `${prefix}.terraformInputs has an empty input name`,
      );
    }
    const inputSpec = spec as Partial<TerraformInputSpec>;
    if (
      !inputSpec ||
      typeof inputSpec !== "object" ||
      Array.isArray(inputSpec)
    ) {
      throw new PluginManifestError(
        `${prefix}.terraformInputs["${name}"] must be an object`,
      );
    }
    requireString(
      inputSpec.description,
      `${prefix}.terraformInputs["${name}"].description`,
    );
    requireString(inputSpec.type, `${prefix}.terraformInputs["${name}"].type`);
  }
}

function validateUiSurfaceComponent(
  component: Partial<UiSurfaceComponent>,
  label: string,
): void {
  const prefix = `${label}: ui-surface "${component.key}"`;
  requireString(component.displayName, `${prefix}.displayName`);
  requireString(component.intendedMount, `${prefix}.intendedMount`);
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PluginManifestError(`${path} is required`);
  }
}

function requireHttpUrl(value: string, path: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PluginManifestError(`${path} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PluginManifestError(`${path} must be an http(s) URL`);
  }
}
