import { and, eq, inArray, or } from "drizzle-orm";
import { tenantCredentials } from "@thinkwork/database-pg/schema";
import { db } from "../../graphql/utils.js";
import {
  HTTP_CREDENTIAL_CONNECTION_PREFIX,
  readRecipeMarker,
  type AslState,
} from "./recipe-catalog.js";

export interface RoutinePublishArtifacts {
  aslJson: unknown;
  markdownSummary: string;
  stepManifestJson: unknown;
}

export interface PreparedRoutineCredentialArtifacts {
  artifacts: RoutinePublishArtifacts;
  warnings: Array<{ code: string; message: string; stateName?: string }>;
}

export interface RoutineCredentialReference {
  handle: string;
  alias: string;
  recipeId: string;
  nodeId?: string;
  usage: "code_binding" | "http_connection";
  requiredFields: string[];
}

interface TenantCredentialRuntimeRow {
  id: string;
  tenant_id: string;
  slug: string;
  display_name: string;
  kind: string;
  status: string;
  eventbridge_connection_arn: string | null;
}

const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REQUIRED_FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ALIASES = new Set(["__proto__", "prototype", "constructor"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_COMPATIBLE_KINDS = new Set([
  "api_key",
  "bearer_token",
  "basic_auth",
]);
const KIND_FIELDS: Record<string, Set<string>> = {
  api_key: new Set(["apiKey"]),
  bearer_token: new Set(["token"]),
  basic_auth: new Set(["username", "password"]),
  soap_partner: new Set(["apiUrl", "username", "password", "partnerId"]),
  webhook_signing_secret: new Set(["secret"]),
  json: new Set(),
};

export async function prepareRoutineCredentialArtifacts(input: {
  tenantId: string;
  artifacts: RoutinePublishArtifacts;
}): Promise<PreparedRoutineCredentialArtifacts> {
  const references = collectRoutineCredentialReferences(input.artifacts);
  const issues = validateReferenceShape(references);
  const credentials = await loadTenantCredentialsForReferences(
    input.tenantId,
    references,
  );
  issues.push(
    ...validateReferenceCredentials(input.tenantId, references, credentials),
  );

  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.message).join("\n"));
  }

  return {
    artifacts: {
      ...input.artifacts,
      aslJson: replaceHttpCredentialPlaceholders(
        input.artifacts.aslJson,
        credentials,
      ),
    },
    warnings: references.map((reference) => ({
      code: "routine_credential_binding",
      stateName: reference.nodeId,
      message:
        reference.usage === "http_connection"
          ? `State '${reference.nodeId ?? reference.alias}' uses tenant credential '${reference.handle}' for HTTP authentication.`
          : `State '${reference.nodeId ?? reference.alias}' declares credential binding '${reference.alias}'.`,
    })),
  };
}

export function collectRoutineCredentialReferences(
  artifacts: RoutinePublishArtifacts,
): RoutineCredentialReference[] {
  const refs: RoutineCredentialReference[] = [];
  const manifest = asRecord(artifacts.stepManifestJson);
  const definition = asRecord(manifest.definition);
  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  for (const value of steps) {
    const step = asRecord(value);
    const recipeId = String(step.recipeId ?? step.recipeType ?? "").trim();
    const nodeId = String(step.nodeId ?? "").trim() || undefined;
    const args = asRecord(step.args);
    refs.push(...referencesFromArgs(recipeId, args, nodeId));
  }

  const asl = asRecord(artifacts.aslJson);
  const states = asRecord(asl.States);
  for (const [nodeId, rawState] of Object.entries(states)) {
    const state = asRecord(rawState) as unknown as AslState;
    const recipeId = readRecipeMarker(state) ?? "";
    const params = asRecord(state.Parameters);
    const payload = asRecord(params.Payload);
    refs.push(...referencesFromArgs(recipeId, payload, nodeId));

    const auth = asRecord(params.Authentication);
    const connectionArn = String(auth.ConnectionArn ?? "");
    const handle = handleFromHttpPlaceholder(connectionArn);
    if (handle) {
      refs.push({
        handle,
        alias: "http",
        recipeId: "http_request",
        nodeId,
        usage: "http_connection",
        requiredFields: [],
      });
    }
  }

  return dedupeReferences(refs);
}

export function validateReferenceShape(
  references: RoutineCredentialReference[],
): Array<{ code: string; message: string; stateName?: string }> {
  const issues: Array<{ code: string; message: string; stateName?: string }> =
    [];
  const aliasesByNode = new Map<string, Set<string>>();

  for (const reference of references) {
    if (!reference.handle) {
      issues.push({
        code: "credential_handle_missing",
        stateName: reference.nodeId,
        message: `State '${reference.nodeId ?? reference.alias}' is missing a credential handle.`,
      });
    }
    if (!isSafeCredentialAlias(reference.alias)) {
      issues.push({
        code: "credential_alias_invalid",
        stateName: reference.nodeId,
        message: `Credential variable '${reference.alias}' must be a safe code identifier.`,
      });
    }
    const nodeKey = reference.nodeId ?? "(unknown)";
    const aliases = aliasesByNode.get(nodeKey) ?? new Set<string>();
    if (aliases.has(reference.alias)) {
      issues.push({
        code: "credential_alias_duplicate",
        stateName: reference.nodeId,
        message: `State '${nodeKey}' declares duplicate credential variable '${reference.alias}'.`,
      });
    }
    aliases.add(reference.alias);
    aliasesByNode.set(nodeKey, aliases);

    const invalidField = reference.requiredFields.find(
      (field) => !REQUIRED_FIELD_RE.test(field),
    );
    if (invalidField) {
      issues.push({
        code: "credential_required_field_invalid",
        stateName: reference.nodeId,
        message: `Credential binding '${reference.alias}' has invalid required field '${invalidField}'.`,
      });
    }
  }

  return issues;
}

function isSafeCredentialAlias(alias: string): boolean {
  return ALIAS_RE.test(alias) && !RESERVED_ALIASES.has(alias);
}

function validateReferenceCredentials(
  tenantId: string,
  references: RoutineCredentialReference[],
  credentials: Map<string, TenantCredentialRuntimeRow>,
): Array<{ code: string; message: string; stateName?: string }> {
  const issues: Array<{ code: string; message: string; stateName?: string }> =
    [];

  for (const reference of references) {
    const credential = credentials.get(reference.handle);
    if (!credential) {
      issues.push({
        code: "credential_not_found",
        stateName: reference.nodeId,
        message: `State '${reference.nodeId ?? reference.alias}' references missing or cross-tenant credential '${reference.handle}'.`,
      });
      continue;
    }
    if (credential.tenant_id !== tenantId) {
      issues.push({
        code: "credential_cross_tenant",
        stateName: reference.nodeId,
        message: `State '${reference.nodeId ?? reference.alias}' references a credential outside this tenant.`,
      });
    }
    if (credential.status !== "active") {
      issues.push({
        code: "credential_inactive",
        stateName: reference.nodeId,
        message: `State '${reference.nodeId ?? reference.alias}' references credential '${credential.display_name}' but it is ${credential.status}.`,
      });
    }
    if (reference.usage === "http_connection") {
      if (!HTTP_COMPATIBLE_KINDS.has(credential.kind)) {
        issues.push({
          code: "credential_http_incompatible",
          stateName: reference.nodeId,
          message: `State '${reference.nodeId ?? reference.alias}' cannot use ${credential.kind} credential '${credential.display_name}' as a native HTTP credential.`,
        });
      }
      if (!credential.eventbridge_connection_arn) {
        issues.push({
          code: "credential_connection_missing",
          stateName: reference.nodeId,
          message: `State '${reference.nodeId ?? reference.alias}' uses credential '${credential.display_name}', but no EventBridge connection ARN is available yet.`,
        });
      }
    }

    const knownFields = KIND_FIELDS[credential.kind] ?? new Set<string>();
    const unknownRequired = reference.requiredFields.filter(
      (field) => knownFields.size > 0 && !knownFields.has(field),
    );
    if (unknownRequired.length > 0) {
      issues.push({
        code: "credential_required_field_unknown",
        stateName: reference.nodeId,
        message: `Credential binding '${reference.alias}' requires unsupported field(s) for ${credential.kind}: ${unknownRequired.join(", ")}.`,
      });
    }
  }

  return issues;
}

async function loadTenantCredentialsForReferences(
  tenantId: string,
  references: RoutineCredentialReference[],
): Promise<Map<string, TenantCredentialRuntimeRow>> {
  const handles = Array.from(
    new Set(references.map((ref) => ref.handle)),
  ).filter(Boolean);
  if (handles.length === 0) return new Map();
  const uuidHandles = handles.filter((handle) => UUID_RE.test(handle));
  const slugHandles = handles.filter((handle) => !UUID_RE.test(handle));
  const handleFilter =
    uuidHandles.length > 0 && slugHandles.length > 0
      ? or(
          inArray(tenantCredentials.id, uuidHandles),
          inArray(tenantCredentials.slug, slugHandles),
        )
      : uuidHandles.length > 0
        ? inArray(tenantCredentials.id, uuidHandles)
        : inArray(tenantCredentials.slug, slugHandles);

  const rows = (await db
    .select({
      id: tenantCredentials.id,
      tenant_id: tenantCredentials.tenant_id,
      slug: tenantCredentials.slug,
      display_name: tenantCredentials.display_name,
      kind: tenantCredentials.kind,
      status: tenantCredentials.status,
      eventbridge_connection_arn: tenantCredentials.eventbridge_connection_arn,
    })
    .from(tenantCredentials)
    .where(
      and(eq(tenantCredentials.tenant_id, tenantId), handleFilter),
    )) as TenantCredentialRuntimeRow[];

  const byHandle = new Map<string, TenantCredentialRuntimeRow>();
  for (const row of rows) {
    byHandle.set(row.id, row);
    byHandle.set(row.slug, row);
  }
  return byHandle;
}

function referencesFromArgs(
  recipeId: string,
  args: Record<string, unknown>,
  nodeId?: string,
): RoutineCredentialReference[] {
  const refs: RoutineCredentialReference[] = [];
  if (recipeId === "python" || recipeId === "typescript") {
    for (const binding of normalizeCredentialBindings(
      args.credentialBindings,
    )) {
      refs.push({ ...binding, recipeId, nodeId, usage: "code_binding" });
    }
  }
  if (recipeId === "http_request") {
    const handle = String(args.credentialId ?? "").trim();
    if (handle) {
      refs.push({
        handle,
        alias: "http",
        recipeId,
        nodeId,
        usage: "http_connection",
        requiredFields: [],
      });
    }
  }
  return refs;
}

function normalizeCredentialBindings(value: unknown): Array<{
  alias: string;
  handle: string;
  requiredFields: string[];
}> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = asRecord(entry);
    return {
      alias: String(raw.alias ?? "").trim(),
      handle: String(raw.credentialId ?? raw.handle ?? "").trim(),
      requiredFields: Array.isArray(raw.requiredFields)
        ? raw.requiredFields
            .map((field) => String(field).trim())
            .filter(Boolean)
        : [],
    };
  });
}

function replaceHttpCredentialPlaceholders(
  aslJson: unknown,
  credentials: Map<string, TenantCredentialRuntimeRow>,
): unknown {
  const cloned = structuredCloneJson(aslJson);
  const doc = asRecord(cloned);
  const states = asRecord(doc.States);
  for (const rawState of Object.values(states)) {
    const state = asRecord(rawState);
    const params = asRecord(state.Parameters);
    const auth = asRecord(params.Authentication);
    const handle = handleFromHttpPlaceholder(String(auth.ConnectionArn ?? ""));
    if (!handle) continue;
    const credential = credentials.get(handle);
    if (credential?.eventbridge_connection_arn) {
      auth.ConnectionArn = credential.eventbridge_connection_arn;
    }
  }
  return cloned;
}

function handleFromHttpPlaceholder(value: string): string | null {
  return value.startsWith(HTTP_CREDENTIAL_CONNECTION_PREFIX)
    ? value.slice(HTTP_CREDENTIAL_CONNECTION_PREFIX.length)
    : null;
}

function dedupeReferences(
  references: RoutineCredentialReference[],
): RoutineCredentialReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = [
      reference.nodeId,
      reference.recipeId,
      reference.alias,
      reference.handle,
      reference.usage,
      reference.requiredFields.join(","),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function structuredCloneJson(value: unknown): unknown {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
