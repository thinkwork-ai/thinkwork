import { GraphQLError } from "graphql";
import type { PiExtensionArtifactDescriptor } from "../../../lib/pi-extensions/artifacts.js";
import {
  piExtensionArtifactHash,
  piExtensionArtifactUri,
} from "../../../lib/pi-extensions/artifacts.js";
import {
  and,
  db,
  eq,
  piExtensionAssignments,
  piExtensionSources,
  piExtensionVersions,
} from "../../utils.js";
import {
  type PiExtensionAssignmentRow,
  type PiExtensionVersionRow,
  toPiExtensionGraphql,
} from "./shared.js";

type PiExtensionReadClient = Pick<typeof db, "select">;

export function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

export function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export async function loadPiExtensionGraphql(input: {
  tenantId: string;
  versionId: string;
  client?: PiExtensionReadClient;
}) {
  const client = input.client ?? db;
  const [row] = await client
    .select({
      version: piExtensionVersions,
      source: piExtensionSources,
    })
    .from(piExtensionVersions)
    .innerJoin(
      piExtensionSources,
      eq(piExtensionVersions.source_id, piExtensionSources.id),
    )
    .where(
      and(
        eq(piExtensionVersions.tenant_id, input.tenantId),
        eq(piExtensionVersions.id, input.versionId),
      ),
    );

  if (!row) {
    throw notFound("Pi extension version not found");
  }

  const assignments = await client
    .select()
    .from(piExtensionAssignments)
    .where(
      and(
        eq(piExtensionAssignments.tenant_id, input.tenantId),
        eq(piExtensionAssignments.version_id, input.versionId),
      ),
    );

  return toPiExtensionGraphql({
    version: row.version,
    source: row.source,
    assignments: assignments as PiExtensionAssignmentRow[],
  });
}

export function assertVersionCanBeApproved(version: PiExtensionVersionRow) {
  if (version.status === "approved") return;
  if (version.status !== "needs_review" && version.status !== "imported") {
    throw badInput("Only verified review candidates can be approved");
  }

  const report = verificationReportObject(version.verification_report);
  if (report.status !== "passed") {
    throw badInput("Pi extension verification must pass before approval");
  }

  const descriptor = artifactDescriptor(report.artifactDescriptor);
  if (!descriptor || !version.artifact_hash || !version.artifact_uri) {
    throw badInput("Pi extension approval requires artifact evidence");
  }

  if (!version.commit_sha || descriptor.commitSha !== version.commit_sha) {
    throw badInput("Pi extension verification source commit is stale");
  }
  if (
    !version.manifest_hash ||
    descriptor.manifestHash !== version.manifest_hash
  ) {
    throw badInput("Pi extension verification manifest hash is stale");
  }
  if (piExtensionArtifactHash(descriptor) !== version.artifact_hash) {
    throw badInput("Pi extension verification artifact hash is stale");
  }
  if (piExtensionArtifactUri(descriptor) !== version.artifact_uri) {
    throw badInput("Pi extension verification artifact URI is stale");
  }

  const source = objectValue(report.source);
  if (source && source.commitSha !== version.commit_sha) {
    throw badInput("Pi extension verification source commit is stale");
  }
}

export function assertVersionCanBeAssigned(
  version: PiExtensionVersionRow,
  enabled: boolean,
) {
  if (enabled && version.status !== "approved") {
    throw badInput("Only approved Pi extension versions can be assigned");
  }
}

export function shouldRejectVersion(version: PiExtensionVersionRow): boolean {
  if (version.status === "rejected") return false;
  if (version.status === "approved") {
    throw badInput(
      "Approved Pi extension versions cannot be rejected; disable assignments instead",
    );
  }
  if (
    version.status !== "needs_review" &&
    version.status !== "imported" &&
    version.status !== "failed_verification"
  ) {
    throw badInput("Pi extension version cannot be rejected from this state");
  }
  return true;
}

export function normalizeGrantedPermissions(input: {
  value: unknown;
  requestedPermissionClasses: readonly string[];
}): Record<string, unknown> {
  const parsed = parseAwsJson(input.value);
  if (parsed === undefined || parsed === null) {
    return { permissionClasses: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badInput("Granted permissions must be a JSON object");
  }
  const permissions = parsed as Record<string, unknown>;
  const grantedClasses = permissions.permissionClasses;
  if (grantedClasses !== undefined) {
    if (
      !Array.isArray(grantedClasses) ||
      grantedClasses.some((value) => typeof value !== "string")
    ) {
      throw badInput("Granted permissionClasses must be an array of strings");
    }
    const requested = new Set(input.requestedPermissionClasses);
    const unknown = grantedClasses.filter((value) => !requested.has(value));
    if (unknown.length > 0) {
      throw badInput(
        "Granted permissionClasses must be requested by the extension",
      );
    }
  }
  return permissions;
}

export function normalizeAssignmentTarget(input: {
  targetType: string;
  agentProfileId?: string | null;
}): {
  targetType: "default_agent" | "agent_profile";
  agentProfileId: string | null;
} {
  const targetType = input.targetType.toLowerCase();
  if (targetType === "default_agent") {
    if (input.agentProfileId) {
      throw badInput("Default Agent assignment must not include profile id");
    }
    return { targetType, agentProfileId: null };
  }
  if (targetType === "agent_profile") {
    if (!input.agentProfileId) {
      throw badInput("Agent Profile assignment requires profile id");
    }
    return { targetType, agentProfileId: input.agentProfileId };
  }
  throw badInput("Unsupported Pi extension assignment target");
}

function parseAwsJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw badInput("Granted permissions must be valid JSON");
  }
}

function verificationReportObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badInput("Pi extension verification evidence is missing");
  }
  return value as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function artifactDescriptor(
  value: unknown,
): PiExtensionArtifactDescriptor | null {
  const descriptor = objectValue(value);
  if (!descriptor) return null;
  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.kind !== "github-source-snapshot" ||
    typeof descriptor.repositoryUrl !== "string" ||
    typeof descriptor.owner !== "string" ||
    typeof descriptor.repo !== "string" ||
    typeof descriptor.commitSha !== "string" ||
    typeof descriptor.sourceRef !== "string" ||
    typeof descriptor.manifestPath !== "string" ||
    typeof descriptor.manifestHash !== "string" ||
    typeof descriptor.runtimeTarget !== "string" ||
    (descriptor.entrypoint !== null &&
      typeof descriptor.entrypoint !== "string") ||
    typeof descriptor.tarballUrl !== "string"
  ) {
    return null;
  }
  return descriptor as unknown as PiExtensionArtifactDescriptor;
}
