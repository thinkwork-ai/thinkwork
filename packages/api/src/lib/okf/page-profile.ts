export const OKF_PAGE_KINDS = [
  "entity",
  "topic",
  "decision",
  "source",
] as const;

export type OkfPageKind = (typeof OKF_PAGE_KINDS)[number];

export const OKF_TENANT_SCOPES = ["tenant", "user", "role"] as const;

export type OkfTenantScope = (typeof OKF_TENANT_SCOPES)[number];

export const OKF_PAGE_STATUSES = [
  "active",
  "superseded",
  "redacted",
  "deleted",
] as const;

export type OkfPageStatus = (typeof OKF_PAGE_STATUSES)[number];

export const OKF_SURFACES = [
  "wiki",
  "brain",
  "memory",
  "knowledge_graph",
] as const;

export type OkfSurface = (typeof OKF_SURFACES)[number];

export interface OkfProvenanceRef {
  kind: string;
  id: string;
  label?: string;
  checksumSha256?: string;
}

export interface OkfRelationshipRef {
  rel: string;
  target: string;
  label?: string;
}

export interface OkfRedactionMetadata {
  posture: string;
  raw_source_ids_redacted: boolean;
}

export interface ThinkworkOkfMetadata {
  version: 1;
  tenant_scope: OkfTenantScope;
  surface: OkfSurface;
  page_kind: OkfPageKind;
  slug: string;
  status: OkfPageStatus;
  ontology_version?: string | null;
  source_bundle_version?: string | null;
  entity_type?: string | null;
  provenance_refs: OkfProvenanceRef[];
  relationships: OkfRelationshipRef[];
  redaction: OkfRedactionMetadata;
}

export interface OkfPageFrontmatter {
  type: string;
  title: string;
  description?: string | null;
  resource?: string | null;
  tags: string[];
  timestamp: string;
  "x-thinkwork": ThinkworkOkfMetadata;
}

export interface OkfPageProfile {
  path: string;
  frontmatter: OkfPageFrontmatter;
  bodyMarkdown: string;
}

export interface OkfValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

const OKF_TYPE_BY_KIND: Record<OkfPageKind, string> = {
  entity: "ThinkWorkEntity",
  topic: "ThinkWorkTopic",
  decision: "ThinkWorkDecision",
  source: "ThinkWorkSource",
};

const SAFE_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function validateOkfPageProfile(
  profile: OkfPageProfile,
): OkfValidationResult<OkfPageProfile> {
  const errors: string[] = [];
  collectPathErrors(profile.path, errors, "path");

  const frontmatter = asRecord(profile.frontmatter);
  if (!frontmatter) {
    errors.push("frontmatter must be an object");
    return { ok: false, errors };
  }

  requireString(frontmatter.type, "frontmatter.type", errors);
  requireString(frontmatter.title, "frontmatter.title", errors);
  requireIsoTimestamp(frontmatter.timestamp, "frontmatter.timestamp", errors);

  if (!Array.isArray(frontmatter.tags)) {
    errors.push("frontmatter.tags must be an array");
  } else {
    for (const [index, tag] of frontmatter.tags.entries()) {
      requireString(tag, `frontmatter.tags[${index}]`, errors);
    }
  }

  const thinkwork = asRecord(frontmatter["x-thinkwork"]);
  if (!thinkwork) {
    errors.push("frontmatter.x-thinkwork is required");
  } else {
    validateThinkworkMetadata(thinkwork, frontmatter.type, errors);
  }

  if (typeof profile.bodyMarkdown !== "string") {
    errors.push("bodyMarkdown must be a string");
  }

  return errors.length === 0
    ? { ok: true, value: profile, errors: [] }
    : { ok: false, errors };
}

export function assertValidOkfPageProfile(
  profile: OkfPageProfile,
): OkfPageProfile {
  const result = validateOkfPageProfile(profile);
  if (!result.ok) {
    throw new Error(`Invalid OKF page profile: ${result.errors.join("; ")}`);
  }
  return profile;
}

export function validateOkfRelativePath(
  path: string,
): OkfValidationResult<string> {
  const errors: string[] = [];
  collectPathErrors(path, errors, "path");
  return errors.length === 0
    ? { ok: true, value: path, errors: [] }
    : { ok: false, errors };
}

export function okfTypeForPageKind(kind: OkfPageKind): string {
  return OKF_TYPE_BY_KIND[kind];
}

function validateThinkworkMetadata(
  metadata: Record<string, unknown>,
  okfType: unknown,
  errors: string[],
): void {
  if (metadata.version !== 1) {
    errors.push("frontmatter.x-thinkwork.version must be 1");
  }
  requireOneOf(
    metadata.tenant_scope,
    OKF_TENANT_SCOPES,
    "frontmatter.x-thinkwork.tenant_scope",
    errors,
  );
  requireOneOf(
    metadata.page_kind,
    OKF_PAGE_KINDS,
    "frontmatter.x-thinkwork.page_kind",
    errors,
  );
  requireOneOf(
    metadata.status,
    OKF_PAGE_STATUSES,
    "frontmatter.x-thinkwork.status",
    errors,
  );
  requireOneOf(
    metadata.surface,
    OKF_SURFACES,
    "frontmatter.x-thinkwork.surface",
    errors,
  );
  requireSlug(metadata.slug, "frontmatter.x-thinkwork.slug", errors);

  const pageKind = metadata.page_kind as OkfPageKind | undefined;
  if (
    pageKind &&
    typeof okfType === "string" &&
    okfType !== OKF_TYPE_BY_KIND[pageKind]
  ) {
    errors.push(
      `frontmatter.type must be ${OKF_TYPE_BY_KIND[pageKind]} for ${pageKind} pages`,
    );
  }

  if (!Array.isArray(metadata.provenance_refs)) {
    errors.push("frontmatter.x-thinkwork.provenance_refs must be an array");
  } else if (metadata.provenance_refs.length === 0) {
    errors.push("frontmatter.x-thinkwork.provenance_refs must not be empty");
  } else {
    for (const [index, ref] of metadata.provenance_refs.entries()) {
      validateProvenanceRef(ref, index, errors);
    }
  }

  if (!Array.isArray(metadata.relationships)) {
    errors.push("frontmatter.x-thinkwork.relationships must be an array");
  } else {
    for (const [index, relationship] of metadata.relationships.entries()) {
      validateRelationshipRef(relationship, index, errors);
    }
  }

  const redaction = asRecord(metadata.redaction);
  if (!redaction) {
    errors.push("frontmatter.x-thinkwork.redaction is required");
  } else {
    requireString(
      redaction.posture,
      "frontmatter.x-thinkwork.redaction.posture",
      errors,
    );
    if (redaction.raw_source_ids_redacted !== true) {
      errors.push(
        "frontmatter.x-thinkwork.redaction.raw_source_ids_redacted must be true",
      );
    }
  }
}

function validateProvenanceRef(
  value: unknown,
  index: number,
  errors: string[],
): void {
  const ref = asRecord(value);
  if (!ref) {
    errors.push(
      `frontmatter.x-thinkwork.provenance_refs[${index}] must be an object`,
    );
    return;
  }
  requireString(
    ref.kind,
    `frontmatter.x-thinkwork.provenance_refs[${index}].kind`,
    errors,
  );
  requireString(
    ref.id,
    `frontmatter.x-thinkwork.provenance_refs[${index}].id`,
    errors,
  );
}

function validateRelationshipRef(
  value: unknown,
  index: number,
  errors: string[],
): void {
  const ref = asRecord(value);
  if (!ref) {
    errors.push(
      `frontmatter.x-thinkwork.relationships[${index}] must be an object`,
    );
    return;
  }
  requireString(
    ref.rel,
    `frontmatter.x-thinkwork.relationships[${index}].rel`,
    errors,
  );
  const target = requireString(
    ref.target,
    `frontmatter.x-thinkwork.relationships[${index}].target`,
    errors,
  );
  if (target) {
    collectPathErrors(
      target,
      errors,
      `frontmatter.x-thinkwork.relationships[${index}].target`,
      { allowParentSegments: true },
    );
  }
}

function collectPathErrors(
  path: unknown,
  errors: string[],
  label: string,
  options: { allowParentSegments?: boolean } = {},
): void {
  if (typeof path !== "string" || path.trim() !== path || path.length === 0) {
    errors.push(`${label} must be a non-empty trimmed string`);
    return;
  }
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) {
    errors.push(`${label} must be relative`);
  }
  if (path.includes("\\") || path.includes("//")) {
    errors.push(`${label} must use normalized POSIX separators`);
  }
  if (!path.endsWith(".md")) {
    errors.push(`${label} must point to a markdown file`);
  }
  for (const segment of path.split("/")) {
    if (
      !segment ||
      segment === "." ||
      (segment === ".." && options.allowParentSegments !== true)
    ) {
      errors.push(`${label} contains an unsafe path segment`);
      continue;
    }
    if (
      segment.startsWith(".") &&
      segment !== ".thinkwork" &&
      !(segment === ".." && options.allowParentSegments === true)
    ) {
      errors.push(`${label} contains a hidden path segment`);
    }
  }
}

function requireString(
  value: unknown,
  label: string,
  errors: string[],
): string | null {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0
  ) {
    errors.push(`${label} must be a non-empty trimmed string`);
    return null;
  }
  return value;
}

function requireSlug(value: unknown, label: string, errors: string[]): void {
  const slug = requireString(value, label, errors);
  if (slug && !SAFE_SLUG_RE.test(slug)) {
    errors.push(`${label} must be a safe slug`);
  }
}

function requireIsoTimestamp(
  value: unknown,
  label: string,
  errors: string[],
): void {
  const timestamp = requireString(value, label, errors);
  if (timestamp && Number.isNaN(Date.parse(timestamp))) {
    errors.push(`${label} must be an ISO timestamp`);
  }
}

function requireOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
