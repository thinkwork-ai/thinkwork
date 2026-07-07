import type { GraphQLContext } from "../../context.js";
import { summarizePlateConformance } from "../../../lib/artifacts/document-conformance.js";
import { requirePlateReader } from "./shared.js";

/**
 * Per-plate conformance aggregates (THINK-189 R7): rates over the report
 * corpus with explicit denominators. Member-gated like every plate read;
 * exposes counts only — never digest content.
 */
export async function plateConformance(
  _parent: unknown,
  args: { tenantId?: string | null; slug: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { tenantId } = await requirePlateReader(ctx, args.tenantId);
  const summary = await summarizePlateConformance(tenantId, args.slug);
  return {
    plateSlug: summary.plateSlug,
    reportCount: summary.reportCount,
    judgedReportCount: summary.judgedReportCount,
    pendingCount: summary.pendingCount,
    errorCount: summary.errorCount,
    skippedCount: summary.skippedCount,
    sections: JSON.stringify(summary.sections),
    analyses: JSON.stringify(summary.analyses),
  };
}
