import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import { runEmailReadinessProbe } from "../../../lib/email-channel/readiness-probes.js";
import { emailReadinessCheckPayload } from "./mappers.js";
import { requireEmailProviderInstall } from "./shared.js";

export async function runEmailReadinessProbeMutation(
  _parent: unknown,
  args: { providerInstallId: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  await requireEmailProviderInstall(ctx, tenantId, args.providerInstallId);
  try {
    const result = await runEmailReadinessProbe({
      db: ctx.db,
      tenantId,
      providerInstallId: args.providerInstallId,
    });
    return result.checks.map(emailReadinessCheckPayload);
  } catch {
    throw new GraphQLError("Email readiness probe failed", {
      extensions: { code: "EMAIL_READINESS_PROBE_FAILED" },
    });
  }
}
