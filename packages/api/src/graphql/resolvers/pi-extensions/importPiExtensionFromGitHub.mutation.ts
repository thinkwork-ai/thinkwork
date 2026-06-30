import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  piExtensionSources,
  piExtensionVersions,
  sql,
} from "../../utils.js";
import {
  GitHubPiExtensionImportError,
  importPiExtensionFromGitHubSource,
} from "../../../lib/pi-extensions/github-import.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { toPiExtensionGraphql } from "./shared.js";

interface ImportPiExtensionFromGitHubArgs {
  input: {
    tenantId: string;
    repositoryUrl: string;
    ref: string;
    manifestPath?: string | null;
  };
}

export async function importPiExtensionFromGitHub(
  _parent: unknown,
  args: ImportPiExtensionFromGitHubArgs,
  ctx: GraphQLContext,
) {
  const { tenantId } = args.input;
  await requireAdminOrServiceCaller(ctx, tenantId, "pi_extensions:import");
  const actorId = await resolveCallerUserId(ctx);

  let imported: Awaited<ReturnType<typeof importPiExtensionFromGitHubSource>>;
  try {
    imported = await importPiExtensionFromGitHubSource({
      request: {
        repositoryUrl: args.input.repositoryUrl,
        ref: args.input.ref,
        manifestPath: args.input.manifestPath,
      },
    });
  } catch (error) {
    if (error instanceof GitHubPiExtensionImportError) {
      throw new GraphQLError(error.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw error;
  }

  const now = new Date();
  const { source, version } = imported;
  const verificationReport = {
    ...version.verificationReport,
    manifestPath: version.manifestPath,
    artifactDescriptor: version.artifactDescriptor,
    source: {
      sourceType: source.sourceType,
      repositoryUrl: source.repositoryUrl,
      owner: source.owner,
      repo: source.repo,
      ref: version.sourceRef,
      commitSha: version.commitSha,
    },
  };

  const persisted = await db.transaction(async (tx) => {
    const [sourceRow] = await tx
      .insert(piExtensionSources)
      .values({
        tenant_id: tenantId,
        source_type: source.sourceType,
        repository_url: source.repositoryUrl,
        repository_owner: source.owner,
        repository_name: source.repo,
        display_name: version.displayName,
        created_by_user_id: actorId,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          piExtensionSources.tenant_id,
          piExtensionSources.source_type,
          piExtensionSources.repository_url,
        ],
        set: {
          repository_owner: source.owner,
          repository_name: source.repo,
          ...(version.displayName != null
            ? { display_name: version.displayName }
            : {}),
          updated_at: now,
        },
      })
      .returning();

    if (!sourceRow) {
      throw new GraphQLError("Failed to record Pi extension source", {
        extensions: { code: "INTERNAL_ERROR" },
      });
    }

    const [existingVersion] = await tx
      .select()
      .from(piExtensionVersions)
      .where(
        and(
          eq(piExtensionVersions.tenant_id, tenantId),
          eq(piExtensionVersions.source_id, sourceRow.id),
          eq(piExtensionVersions.commit_sha, version.commitSha),
        ),
      );

    if (
      existingVersion?.status === "approved" ||
      existingVersion?.status === "rejected"
    ) {
      return { source: sourceRow, version: existingVersion };
    }

    const [versionRow] = await tx
      .insert(piExtensionVersions)
      .values({
        tenant_id: tenantId,
        source_id: sourceRow.id,
        display_name: version.displayName,
        description: version.description,
        source_ref: version.sourceRef,
        commit_sha: version.commitSha,
        manifest_hash: version.manifestHash,
        artifact_hash: version.artifactHash,
        artifact_uri: version.artifactUri,
        runtime_target: version.runtimeTarget,
        status: version.status,
        status_reason: version.statusReason,
        manifest: version.manifest as Record<string, unknown>,
        tool_names: version.toolNames,
        lifecycle_hooks: version.lifecycleHooks,
        permission_classes: version.permissionClasses,
        verification_report: verificationReport,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [
          piExtensionVersions.tenant_id,
          piExtensionVersions.source_id,
          piExtensionVersions.commit_sha,
        ],
        setWhere: sql`${piExtensionVersions.status} NOT IN ('approved', 'rejected')`,
        set: {
          display_name: version.displayName,
          description: version.description,
          source_ref: version.sourceRef,
          manifest_hash: version.manifestHash,
          artifact_hash: version.artifactHash,
          artifact_uri: version.artifactUri,
          runtime_target: version.runtimeTarget,
          status: version.status,
          status_reason: version.statusReason,
          manifest: version.manifest as Record<string, unknown>,
          tool_names: version.toolNames,
          lifecycle_hooks: version.lifecycleHooks,
          permission_classes: version.permissionClasses,
          verification_report: verificationReport,
          updated_at: now,
        },
      })
      .returning();

    if (!versionRow) {
      const [currentVersion] = await tx
        .select()
        .from(piExtensionVersions)
        .where(
          and(
            eq(piExtensionVersions.tenant_id, tenantId),
            eq(piExtensionVersions.source_id, sourceRow.id),
            eq(piExtensionVersions.commit_sha, version.commitSha),
          ),
        );
      if (currentVersion) {
        return { source: sourceRow, version: currentVersion };
      }
    }

    if (!versionRow) {
      throw new GraphQLError("Failed to record Pi extension version", {
        extensions: { code: "INTERNAL_ERROR" },
      });
    }

    return { source: sourceRow, version: versionRow };
  });

  return toPiExtensionGraphql({
    version: persisted.version,
    source: persisted.source,
    assignments: [],
  });
}
