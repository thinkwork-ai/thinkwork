/**
 * Field resolvers for the Artifact GraphQL type — the read-only nested reads
 * introduced by Living Artifacts U1 (THINK-145): the pinned version chain and
 * the per-widget data-source bindings.
 *
 * These are lazy: they only run when the client selects `versions` / `bindings`
 * on an Artifact, so the base `artifact(s)` queries stay unchanged.
 */

import { redactBindingArgs } from "@thinkwork/thread-json-render";
import {
  and,
  artifactDataBindings,
  artifactVersions,
  db,
  desc,
  eq,
  snakeToCamel,
} from "../../utils.js";
import { isDocumentMetadata } from "../../../lib/artifacts/document-emission.js";
import {
  artifactRenderKey,
  readArtifactPayloadFromS3,
} from "../../../lib/artifacts/payload-storage.js";

function resolveTenantId(parent: any): string | null {
  return parent?.tenantId ?? parent?.tenant_id ?? null;
}

export const artifactTypeResolvers = {
  /**
   * HTML Document Artifacts (THINK-147 U5): the single-file HTML render body
   * for document-kind artifacts, read from the render head key. Lazy — runs
   * only when selected — and served exclusively through this resolver behind
   * the parent query's access gate; presigned render URLs are prohibited
   * (agent-authored HTML must never be served from a raw origin).
   */
  renderHtml: async (parent: any) => {
    const tenantId = resolveTenantId(parent);
    if (!parent?.id || !tenantId) return null;
    if (!isDocumentMetadata(parent.metadata)) return null;
    const key = artifactRenderKey({ tenantId, artifactId: parent.id });
    try {
      return await readArtifactPayloadFromS3({ tenantId, key });
    } catch (err) {
      console.error(
        `[artifact.renderHtml] read failed for ${parent.id}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },

  versions: async (parent: any) => {
    const tenantId = resolveTenantId(parent);
    if (!parent?.id || !tenantId) return [];
    const rows = await db
      .select()
      .from(artifactVersions)
      .where(
        and(
          eq(artifactVersions.tenant_id, tenantId),
          eq(artifactVersions.artifact_id, parent.id),
        ),
      )
      .orderBy(desc(artifactVersions.version));
    return rows.map((row) => snakeToCamel(row));
  },

  bindings: async (parent: any) => {
    const tenantId = resolveTenantId(parent);
    if (!parent?.id || !tenantId) return [];
    const rows = await db
      .select()
      .from(artifactDataBindings)
      .where(
        and(
          eq(artifactDataBindings.tenant_id, tenantId),
          eq(artifactDataBindings.artifact_id, parent.id),
        ),
      );
    return rows.map((row) => {
      const camel = snakeToCamel(row) as Record<string, unknown>;
      // GraphQL enum fields are uppercased; DB stores lowercase tokens.
      if (typeof camel.authContext === "string") {
        camel.authContext = camel.authContext.toUpperCase();
      }
      if (typeof camel.quality === "string") {
        camel.quality = camel.quality.toUpperCase();
      }
      // KTD9: never expose raw frozen_args. Provenance shows redactedArgs only,
      // computed server-side through the redaction gate (R15 audience is every
      // space member). The raw column is dropped from the resolved shape.
      camel.redactedArgs = redactBindingArgs(row.frozen_args);
      delete camel.frozenArgs;
      return camel;
    });
  },
};
