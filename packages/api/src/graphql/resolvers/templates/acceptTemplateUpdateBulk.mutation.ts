/**
 * acceptTemplateUpdateBulk mutation (Unit 9).
 *
 * Advances the pinned hash on every agent that shares a template. Required
 * at enterprise scale — accepting a GUARDRAILS.md update across 100 agents
 * would be 100 single-mutation clicks otherwise.
 *
 * Shape:
 *   acceptTemplateUpdateBulk(templateId, filename, tenantId) →
 *     { accepted, failed, results: [{ agentId, success, error? }] }
 *
 * Admin-gated at the tenant scope (caller must be owner/admin of
 * `tenantId`). The `tenantId` argument is required even though the
 * template itself is tenant-scoped — having the caller declare intent
 * lets us surface an explicit FORBIDDEN when they hit the wrong tenant.
 *
 * Partial failure is supported: individual agent failures are collected
 * into `results` rather than aborting the whole batch. The aggregate
 * `failed` counter lets the UI surface "N of M advanced; see errors."
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { agents, agentTemplates, db, eq, and, tenants } from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  computeSha256,
  readTemplateBaseWithFallback,
} from "../../../lib/pinned-versions.js";
import {
  applyPinAdvance,
  isPinnedFile,
  normalizePins,
} from "../agents/acceptTemplateUpdate.mutation.js";

export interface BulkResultPerAgent {
  agentId: string;
  success: boolean;
  error?: string;
}

export async function acceptTemplateUpdateBulk(
  _parent: unknown,
  args: { templateId: string; filename: string; tenantId: string },
  ctx: GraphQLContext,
) {
  const { templateId, filename, tenantId } = args;

  if (filename.includes("/") || !isPinnedFile(filename)) {
    throw new GraphQLError(
      `acceptTemplateUpdateBulk: '${filename}' is not a root pinned-class file`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  await requireTenantAdmin(ctx, tenantId);

  // Template must exist AND belong to the caller's tenant. 404 on
  // mismatch rather than FORBIDDEN so we don't leak the existence of
  // the template in another tenant.
  const [template] = await db
    .select({
      id: agentTemplates.id,
      slug: agentTemplates.slug,
      tenant_id: agentTemplates.tenant_id,
    })
    .from(agentTemplates)
    .where(eq(agentTemplates.id, templateId));
  if (!template || template.tenant_id !== tenantId || !template.slug) {
    throw new GraphQLError("Template not found in your tenant", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    throw new GraphQLError("Tenant slug missing", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }

  // Compute the latest content + hash once — all agents share the same
  // template base, so this is a single read regardless of agent count.
  const latestContent = await readTemplateBaseWithFallback(
    tenant.slug,
    template.slug,
    filename,
  );
  if (latestContent === null) {
    throw new GraphQLError(
      `No template-base content for ${filename} — cannot advance pin`,
      { extensions: { code: "NOT_FOUND" } },
    );
  }
  const latestHex = computeSha256(latestContent);

  // Load agents referencing this template within the tenant.
  const targets = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      agent_pinned_versions: agents.agent_pinned_versions,
    })
    .from(agents)
    .where(
      and(eq(agents.template_id, template.id), eq(agents.tenant_id, tenantId)),
    );

  const results: BulkResultPerAgent[] = [];
  let accepted = 0;
  let failed = 0;

  for (const agent of targets) {
    if (!agent.slug) {
      results.push({
        agentId: agent.id,
        success: false,
        error: "Agent has no slug",
      });
      failed++;
      continue;
    }
    try {
      const row = await applyPinAdvance({
        agentId: agent.id,
        agentSlug: agent.slug,
        tenantId,
        tenantSlug: tenant.slug,
        templateSlug: template.slug,
        filename,
        currentPins: normalizePins(agent.agent_pinned_versions),
        latestContent,
        latestHex,
      });
      if (row) {
        accepted++;
        results.push({ agentId: agent.id, success: true });
      } else {
        failed++;
        results.push({
          agentId: agent.id,
          success: false,
          error: "Agent row disappeared mid-advance",
        });
      }
    } catch (err) {
      failed++;
      const message =
        (err as { message?: string } | null)?.message ||
        String(err) ||
        "unknown error";
      results.push({ agentId: agent.id, success: false, error: message });
    }
  }

  return { accepted, failed, results };
}
