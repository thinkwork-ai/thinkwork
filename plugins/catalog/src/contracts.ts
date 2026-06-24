/**
 * Plugin manifest contracts.
 *
 * A plugin is a versioned package described by a manifest declaring identity
 * and components. Component types:
 *
 *   - `mcp-server`     — a hosted MCP endpoint the agent dispatches to
 *   - `skills`         — bundled skill folders seeded into the tenant catalog
 *   - `infrastructure` — a managed-app Terraform deployment
 *   - `ui-surface`     — declared-only in v1 (identity + intended mount)
 *   - `auth-provider`  — declared/admin-configured login federation capability
 *
 * Capability declarations are catalog metadata, not install lifecycle
 * components. They let a plugin advertise channel contracts whose runtime is
 * owned by shared platform handlers.
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
  "auth-provider",
] as const;

export type PluginComponentType = (typeof PLUGIN_COMPONENT_TYPES)[number];

export const EMAIL_CHANNEL_PROVIDER_KEYS = [
  "resend",
  "sendgrid",
  "ses",
] as const;

export type EmailChannelProviderKey =
  (typeof EMAIL_CHANNEL_PROVIDER_KEYS)[number];

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
       * User-provided HTTP headers for PAT/header-based MCP auth. Activation stores
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
  | {
      /**
       * Tenant-owned service credential (e.g. n8n instance-level MCP access).
       * The manifest declares only the credential kind, the managed-app
       * desired_config key that holds a Secrets Manager secret ref, and the
       * HTTP header shape. Secret values are resolved server-side during MCP
       * dispatch and are never exposed through plugin activation.
       */
      mode: "tenant-service-credential";
      /** Stable non-secret kind for audit/evidence, e.g. n8n-mcp-access-token. */
      credentialKind: string;
      /** managed_applications.desired_config key holding the secret ARN/name. */
      secretRefConfigKey: string;
      /** Header bindings sourced from JSON keys inside the tenant secret. */
      headers: McpTenantServiceCredentialHeader[];
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

export interface McpTenantServiceCredentialHeader {
  /** HTTP header name required by the service, e.g. `Authorization`. */
  name: string;
  /** JSON key inside the tenant service credential secret. */
  secretJsonKey: string;
  /**
   * Static prefix prepended at dispatch. Authorization headers must use
   * `Bearer ` so the Pi runtime can route the secret through its handle store.
   */
  valuePrefix?: string;
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

export interface McpRecordLinkRouteHint {
  /** Provider-neutral object key, e.g. `opportunity`. */
  objectType: string;
  /** Relative browser route template containing exactly one `{id}` placeholder. */
  routeTemplate: string;
  /** Candidate fields in the MCP result that can contain the record id. */
  idFields?: string[];
  /** Candidate fields in the MCP result that can contain a human label. */
  labelFields?: string[];
}

export interface McpRecordLinkWorkspaceHint {
  /** Optional non-secret field whose value can be appended as a URL hash. */
  hashField?: string;
}

export interface McpRecordLinkHints {
  /** Contract version for runtime metadata repair/audit decisions. */
  schemaVersion: 1;
  /** Declares where the static route hints came from. */
  source: "plugin-manifest";
  /** Supported record routes. Browser origins are resolved during provisioning. */
  routes: McpRecordLinkRouteHint[];
  /** Optional workspace/hash metadata. Never stores a credential. */
  workspace?: McpRecordLinkWorkspaceHint;
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
  /** Optional non-secret hints for generating links from trusted MCP results. */
  recordLinkHints?: McpRecordLinkHints;
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

export const AUTH_PROVIDER_KEYS = ["workos"] as const;

export type AuthProviderKey = (typeof AUTH_PROVIDER_KEYS)[number];

export const AUTH_PROVIDER_CONFIG_FIELD_STORAGE = [
  "metadata",
  "secret-ref",
] as const;

export type AuthProviderConfigFieldStorage =
  (typeof AUTH_PROVIDER_CONFIG_FIELD_STORAGE)[number];

export interface AuthProviderConfigField {
  /** Operator-facing input key; values are never present in the manifest. */
  key: string;
  displayName: string;
  required: boolean;
  /**
   * metadata: non-secret config such as issuer/client id.
   * secret-ref: stored only as an operator-managed secret reference.
   */
  storage: AuthProviderConfigFieldStorage;
}

export interface AuthProviderPublicOption {
  /**
   * Public-safe option key. For the U1-approved fallback this is `sso`; do not
   * use provider-specific Google/Microsoft keys unless routing evidence exists.
   */
  key: string;
  displayName: string;
  providerSpecific: boolean;
  recommended?: boolean;
}

export interface AuthProviderComponent {
  type: "auth-provider";
  key: string;
  displayName: string;
  provider: AuthProviderKey;
  settingsSurface: string;
  /** Cognito IdP name the validated bridge will use; not a secret. */
  cognitoIdentityProviderName: string;
  configFields: AuthProviderConfigField[];
  publicOptions: AuthProviderPublicOption[];
}

export type PluginComponent =
  | McpServerComponent
  | SkillsComponent
  | InfrastructureComponent
  | UiSurfaceComponent
  | AuthProviderComponent;

export interface EmailChannelProviderOption {
  key: EmailChannelProviderKey;
  displayName: string;
  recommended?: boolean;
  compatibility?: boolean;
}

export interface EmailChannelCapability {
  type: "email-channel";
  key: string;
  displayName: string;
  providers: EmailChannelProviderOption[];
  settingsSurface: string;
}

export type PluginCapability = EmailChannelCapability;

export interface PluginVersion {
  /** Semver string (SEMVER_RE). */
  version: string;
  /** OAuth scopes this version's MCP servers require at activation. */
  requiredOauthScopes: string[];
  /**
   * Declared catalog capabilities that are implemented by shared platform
   * handlers or reserved UI surfaces, rather than plugin-engine components.
   */
  capabilities?: PluginCapability[];
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
  const seenCapabilityKeys = new Set<string>();
  const seenSkillSlugs = new Set<string>();
  let hasOauthServer = false;

  if (version.capabilities !== undefined) {
    if (!Array.isArray(version.capabilities)) {
      throw new PluginManifestError(`${label}: capabilities must be an array`);
    }
    for (const capability of version.capabilities as Partial<PluginCapability>[]) {
      validatePluginCapability(capability, label, seenCapabilityKeys);
    }
  }

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
      case "auth-provider":
        validateAuthProviderComponent(
          component as AuthProviderComponent,
          label,
        );
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

function validatePluginCapability(
  capability: Partial<PluginCapability>,
  label: string,
  seenCapabilityKeys: Set<string>,
): void {
  if (
    !capability ||
    typeof capability !== "object" ||
    Array.isArray(capability)
  ) {
    throw new PluginManifestError(
      `${label}: each capability must be an object`,
    );
  }
  if (capability.type !== "email-channel") {
    throw new PluginManifestError(
      `${label}: unknown capability type "${String(capability.type)}"`,
    );
  }
  requireString(capability.key, `${label}: capability.key`);
  if (!SLUG_RE.test(capability.key)) {
    throw new PluginManifestError(
      `${label}: capability key "${capability.key}" must match ${SLUG_RE.source}`,
    );
  }
  if (seenCapabilityKeys.has(capability.key)) {
    throw new PluginManifestError(
      `${label}: duplicate capability key "${capability.key}"`,
    );
  }
  seenCapabilityKeys.add(capability.key);
  validateEmailChannelCapability(capability as EmailChannelCapability, label);
}

function validateEmailChannelCapability(
  capability: Partial<EmailChannelCapability>,
  label: string,
): void {
  const prefix = `${label}: email-channel "${capability.key}"`;
  requireString(capability.displayName, `${prefix}.displayName`);
  requireString(capability.settingsSurface, `${prefix}.settingsSurface`);
  if (
    !Array.isArray(capability.providers) ||
    capability.providers.length === 0
  ) {
    throw new PluginManifestError(
      `${prefix}.providers must be a non-empty array`,
    );
  }

  const seenProviders = new Set<string>();
  let recommendedCount = 0;
  for (const [index, provider] of capability.providers.entries()) {
    const providerPrefix = `${prefix}.providers[${index}]`;
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
      throw new PluginManifestError(`${providerPrefix} must be an object`);
    }
    requireString(provider.key, `${providerPrefix}.key`);
    if (
      !(EMAIL_CHANNEL_PROVIDER_KEYS as readonly string[]).includes(provider.key)
    ) {
      throw new PluginManifestError(
        `${providerPrefix}.key "${provider.key}" is not a supported email-channel provider`,
      );
    }
    if (seenProviders.has(provider.key)) {
      throw new PluginManifestError(
        `${prefix}.providers declares duplicate provider "${provider.key}"`,
      );
    }
    seenProviders.add(provider.key);
    requireString(provider.displayName, `${providerPrefix}.displayName`);
    if (
      provider.recommended !== undefined &&
      typeof provider.recommended !== "boolean"
    ) {
      throw new PluginManifestError(
        `${providerPrefix}.recommended must be a boolean`,
      );
    }
    if (
      provider.compatibility !== undefined &&
      typeof provider.compatibility !== "boolean"
    ) {
      throw new PluginManifestError(
        `${providerPrefix}.compatibility must be a boolean`,
      );
    }
    if (provider.recommended === true) recommendedCount += 1;
  }
  if (recommendedCount !== 1) {
    throw new PluginManifestError(
      `${prefix}.providers must declare exactly one recommended provider`,
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
  if (component.recordLinkHints !== undefined) {
    validateRecordLinkHints(component.recordLinkHints, prefix);
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
  if (auth.mode === "tenant-service-credential") {
    if (component.endpointFrom === undefined) {
      throw new PluginManifestError(
        `${prefix}.auth.mode "tenant-service-credential" requires endpointFrom so the service credential secret ref can resolve from the managed app desired_config`,
      );
    }
    validateTenantServiceCredentialAuth(auth, prefix);
    return false;
  }
  if (auth.mode !== "oauth") {
    throw new PluginManifestError(
      `${prefix}.auth.mode must be "oauth", "oauth-per-instance", "user-provided-headers", "tenant-service-credential", or "none"`,
    );
  }
  const oauth = auth as Partial<Extract<McpServerAuth, { mode: "oauth" }>>;
  requireString(oauth.authDomain, `${prefix}.auth.authDomain`);
  requireHttpUrl(oauth.authDomain, `${prefix}.auth.authDomain`);
  requireString(oauth.resourceIndicator, `${prefix}.auth.resourceIndicator`);
  return true;
}

const RECORD_LINK_FIELD_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const RECORD_LINK_ALLOWED_HINT_KEYS = [
  "schemaVersion",
  "source",
  "routes",
  "workspace",
] as const;
const RECORD_LINK_ALLOWED_ROUTE_KEYS = [
  "objectType",
  "routeTemplate",
  "idFields",
  "labelFields",
] as const;
const RECORD_LINK_ALLOWED_WORKSPACE_KEYS = ["hashField"] as const;
const RECORD_LINK_TEMPLATE_SEGMENT_RE = /^[A-Za-z0-9._~-]+$|^\{id\}$/;
const RECORD_LINK_FORBIDDEN_FIELD_PARTS = [
  "auth_config",
  "authorization",
  "cookie",
  "token",
  "secret",
  "password",
  "credential",
  "header",
] as const;

function validateRecordLinkHints(
  hints: Partial<McpRecordLinkHints>,
  prefix: string,
): void {
  const label = `${prefix}.recordLinkHints`;
  if (!hints || typeof hints !== "object" || Array.isArray(hints)) {
    throw new PluginManifestError(`${label} must be an object`);
  }
  rejectUnknownKeys(
    hints as Record<string, unknown>,
    RECORD_LINK_ALLOWED_HINT_KEYS,
    label,
  );
  if (hints.schemaVersion !== 1) {
    throw new PluginManifestError(`${label}.schemaVersion must be 1`);
  }
  if (hints.source !== "plugin-manifest") {
    throw new PluginManifestError(`${label}.source must be "plugin-manifest"`);
  }
  if (!Array.isArray(hints.routes) || hints.routes.length === 0) {
    throw new PluginManifestError(`${label}.routes must be a non-empty array`);
  }

  const seenObjectTypes = new Set<string>();
  for (const [index, route] of hints.routes.entries()) {
    const routeLabel = `${label}.routes[${index}]`;
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      throw new PluginManifestError(`${routeLabel} must be an object`);
    }
    rejectUnknownKeys(
      route as unknown as Record<string, unknown>,
      RECORD_LINK_ALLOWED_ROUTE_KEYS,
      routeLabel,
    );
    requireString(route.objectType, `${routeLabel}.objectType`);
    if (!SLUG_RE.test(route.objectType)) {
      throw new PluginManifestError(
        `${routeLabel}.objectType "${route.objectType}" must match ${SLUG_RE.source}`,
      );
    }
    if (seenObjectTypes.has(route.objectType)) {
      throw new PluginManifestError(
        `${label}.routes declares duplicate objectType "${route.objectType}"`,
      );
    }
    seenObjectTypes.add(route.objectType);

    requireString(route.routeTemplate, `${routeLabel}.routeTemplate`);
    validateRecordLinkRouteTemplate(
      route.routeTemplate,
      `${routeLabel}.routeTemplate`,
    );

    validateOptionalFieldList(route.idFields, `${routeLabel}.idFields`);
    validateOptionalFieldList(route.labelFields, `${routeLabel}.labelFields`);
  }

  if (hints.workspace !== undefined) {
    if (
      !hints.workspace ||
      typeof hints.workspace !== "object" ||
      Array.isArray(hints.workspace)
    ) {
      throw new PluginManifestError(`${label}.workspace must be an object`);
    }
    rejectUnknownKeys(
      hints.workspace as Record<string, unknown>,
      RECORD_LINK_ALLOWED_WORKSPACE_KEYS,
      `${label}.workspace`,
    );
    if (hints.workspace.hashField !== undefined) {
      validateFieldName(
        hints.workspace.hashField,
        `${label}.workspace.hashField`,
      );
    }
  }
}

function validateRecordLinkRouteTemplate(value: string, label: string): void {
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new PluginManifestError(
      `${label} must be a relative path containing exactly one "{id}" segment`,
    );
  }
  if (
    /[?#\\%\s<>\[\]()"']/.test(value) ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new PluginManifestError(
      `${label} must not contain query, fragment, encoded separator, whitespace, control, or markup characters`,
    );
  }

  const placeholders = value.match(/\{[^}]*\}/g) ?? [];
  if (placeholders.length !== 1 || placeholders[0] !== "{id}") {
    throw new PluginManifestError(
      `${label} must contain exactly one "{id}" placeholder and no other placeholders`,
    );
  }

  const segments = value.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) {
    throw new PluginManifestError(`${label} must not contain empty segments`);
  }
  let idSegmentCount = 0;
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new PluginManifestError(`${label} must not contain dot segments`);
    }
    if (!RECORD_LINK_TEMPLATE_SEGMENT_RE.test(segment)) {
      throw new PluginManifestError(
        `${label} contains an unsupported path segment "${segment}"`,
      );
    }
    if (segment === "{id}") idSegmentCount += 1;
  }
  if (idSegmentCount !== 1) {
    throw new PluginManifestError(
      `${label} must use "{id}" as exactly one full path segment`,
    );
  }
}

function validateOptionalFieldList(
  fields: string[] | undefined,
  label: string,
): void {
  if (fields === undefined) return;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new PluginManifestError(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  for (const [index, field] of fields.entries()) {
    validateFieldName(field, `${label}[${index}]`);
    if (seen.has(field)) {
      throw new PluginManifestError(
        `${label} declares duplicate field "${field}"`,
      );
    }
    seen.add(field);
  }
}

function validateFieldName(
  value: unknown,
  label: string,
): asserts value is string {
  requireString(value, label);
  if (!RECORD_LINK_FIELD_RE.test(value)) {
    throw new PluginManifestError(
      `${label} "${value}" must match ${RECORD_LINK_FIELD_RE.source}`,
    );
  }
  const normalized = value.toLowerCase();
  const parts = normalized.split(/[_.-]+/);
  const hasSensitivePart =
    parts.includes("auth") ||
    RECORD_LINK_FORBIDDEN_FIELD_PARTS.some((part) => normalized.includes(part));
  if (hasSensitivePart) {
    throw new PluginManifestError(
      `${label} must not reference credential-shaped data`,
    );
  }
}

const HTTP_HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CREDENTIAL_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_USER_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
]);
const FORBIDDEN_SERVICE_CREDENTIAL_HEADER_NAMES = new Set([
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

function validateTenantServiceCredentialAuth(
  auth: Partial<Extract<McpServerAuth, { mode: "tenant-service-credential" }>>,
  prefix: string,
): void {
  requireString(auth.credentialKind, `${prefix}.auth.credentialKind`);
  if (!SLUG_RE.test(auth.credentialKind)) {
    throw new PluginManifestError(
      `${prefix}.auth.credentialKind "${auth.credentialKind}" must match ${SLUG_RE.source}`,
    );
  }
  requireString(auth.secretRefConfigKey, `${prefix}.auth.secretRefConfigKey`);
  if (!CREDENTIAL_KEY_RE.test(auth.secretRefConfigKey)) {
    throw new PluginManifestError(
      `${prefix}.auth.secretRefConfigKey "${auth.secretRefConfigKey}" must match ${CREDENTIAL_KEY_RE.source}`,
    );
  }
  if (!Array.isArray(auth.headers) || auth.headers.length === 0) {
    throw new PluginManifestError(
      `${prefix}.auth.headers must be a non-empty array`,
    );
  }
  const seenHeaderNames = new Set<string>();
  for (const [index, header] of auth.headers.entries()) {
    const label = `${prefix}.auth.headers[${index}]`;
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      throw new PluginManifestError(`${label} must be an object`);
    }
    rejectManifestValueCarrier(
      header as unknown as Record<string, unknown>,
      label,
      "tenant-service-credential manifests",
    );
    requireString(header.name, `${label}.name`);
    if (!HTTP_HEADER_NAME_RE.test(header.name)) {
      throw new PluginManifestError(
        `${label}.name "${header.name}" must be a valid HTTP header name`,
      );
    }
    const normalizedName = header.name.toLowerCase();
    if (FORBIDDEN_SERVICE_CREDENTIAL_HEADER_NAMES.has(normalizedName)) {
      throw new PluginManifestError(
        `${label}.name "${header.name}" is not allowed for tenant service credential auth`,
      );
    }
    if (seenHeaderNames.has(normalizedName)) {
      throw new PluginManifestError(
        `${prefix}.auth.headers declares duplicate header "${header.name}"`,
      );
    }
    seenHeaderNames.add(normalizedName);

    requireString(header.secretJsonKey, `${label}.secretJsonKey`);
    if (!CREDENTIAL_KEY_RE.test(header.secretJsonKey)) {
      throw new PluginManifestError(
        `${label}.secretJsonKey "${header.secretJsonKey}" must match ${CREDENTIAL_KEY_RE.source}`,
      );
    }
    if (
      header.valuePrefix !== undefined &&
      typeof header.valuePrefix !== "string"
    ) {
      throw new PluginManifestError(`${label}.valuePrefix must be a string`);
    }
    if (
      normalizedName === "authorization" &&
      header.valuePrefix !== "Bearer "
    ) {
      throw new PluginManifestError(
        `${label}.valuePrefix must be "Bearer " for Authorization service credentials`,
      );
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

function validateAuthProviderComponent(
  component: Partial<AuthProviderComponent>,
  label: string,
): void {
  const prefix = `${label}: auth-provider "${component.key}"`;
  requireString(component.displayName, `${prefix}.displayName`);
  if (
    typeof component.provider !== "string" ||
    !(AUTH_PROVIDER_KEYS as readonly string[]).includes(component.provider)
  ) {
    throw new PluginManifestError(
      `${prefix}.provider "${String(component.provider)}" is not supported`,
    );
  }
  requireString(component.settingsSurface, `${prefix}.settingsSurface`);
  requireString(
    component.cognitoIdentityProviderName,
    `${prefix}.cognitoIdentityProviderName`,
  );

  if (
    !Array.isArray(component.configFields) ||
    component.configFields.length === 0
  ) {
    throw new PluginManifestError(
      `${prefix}.configFields must be a non-empty array`,
    );
  }
  const seenConfigKeys = new Set<string>();
  for (const [index, field] of component.configFields.entries()) {
    const fieldPrefix = `${prefix}.configFields[${index}]`;
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw new PluginManifestError(`${fieldPrefix} must be an object`);
    }
    rejectManifestValueCarrier(
      field as unknown as Record<string, unknown>,
      fieldPrefix,
    );
    requireString(field.key, `${fieldPrefix}.key`);
    if (!CREDENTIAL_KEY_RE.test(field.key)) {
      throw new PluginManifestError(
        `${fieldPrefix}.key "${field.key}" must match ${CREDENTIAL_KEY_RE.source}`,
      );
    }
    if (seenConfigKeys.has(field.key)) {
      throw new PluginManifestError(
        `${prefix}.configFields declares duplicate key "${field.key}"`,
      );
    }
    seenConfigKeys.add(field.key);
    requireString(field.displayName, `${fieldPrefix}.displayName`);
    if (typeof field.required !== "boolean") {
      throw new PluginManifestError(
        `${fieldPrefix}.required must be a boolean`,
      );
    }
    if (
      !(AUTH_PROVIDER_CONFIG_FIELD_STORAGE as readonly string[]).includes(
        field.storage,
      )
    ) {
      throw new PluginManifestError(
        `${fieldPrefix}.storage must be one of ${AUTH_PROVIDER_CONFIG_FIELD_STORAGE.join(", ")}`,
      );
    }
  }

  if (
    !Array.isArray(component.publicOptions) ||
    component.publicOptions.length === 0
  ) {
    throw new PluginManifestError(
      `${prefix}.publicOptions must be a non-empty array`,
    );
  }
  const seenOptionKeys = new Set<string>();
  let recommendedCount = 0;
  for (const [index, option] of component.publicOptions.entries()) {
    const optionPrefix = `${prefix}.publicOptions[${index}]`;
    if (!option || typeof option !== "object" || Array.isArray(option)) {
      throw new PluginManifestError(`${optionPrefix} must be an object`);
    }
    rejectManifestValueCarrier(
      option as unknown as Record<string, unknown>,
      optionPrefix,
    );
    requireString(option.key, `${optionPrefix}.key`);
    if (!SLUG_RE.test(option.key)) {
      throw new PluginManifestError(
        `${optionPrefix}.key "${option.key}" must match ${SLUG_RE.source}`,
      );
    }
    if (seenOptionKeys.has(option.key)) {
      throw new PluginManifestError(
        `${prefix}.publicOptions declares duplicate key "${option.key}"`,
      );
    }
    seenOptionKeys.add(option.key);
    requireString(option.displayName, `${optionPrefix}.displayName`);
    if (typeof option.providerSpecific !== "boolean") {
      throw new PluginManifestError(
        `${optionPrefix}.providerSpecific must be a boolean`,
      );
    }
    if (
      option.recommended !== undefined &&
      typeof option.recommended !== "boolean"
    ) {
      throw new PluginManifestError(
        `${optionPrefix}.recommended must be a boolean`,
      );
    }
    if (option.recommended === true) recommendedCount += 1;
  }
  if (recommendedCount !== 1) {
    throw new PluginManifestError(
      `${prefix}.publicOptions must declare exactly one recommended option`,
    );
  }
}

function rejectManifestValueCarrier(
  value: Record<string, unknown>,
  prefix: string,
  context = "auth-provider manifests",
): void {
  for (const key of ["value", "secret", "defaultValue", "currentValue"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new PluginManifestError(
        `${prefix}.${key} is not allowed in ${context}`,
      );
    }
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  prefix: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PluginManifestError(`${prefix}.${key} is not allowed`);
    }
  }
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
