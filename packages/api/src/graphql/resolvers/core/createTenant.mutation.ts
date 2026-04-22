import type { GraphQLContext } from "../../context.js";
import { db, tenants, snakeToCamel, generateSlug } from "../../utils.js";
import {
  invokeProvisionTenantSandbox,
  SandboxProvisioningConfigError,
} from "../../../lib/sandbox-provisioning.js";

export const createTenant = async (
  _parent: any,
  args: any,
  _ctx: GraphQLContext,
) => {
  const i = args.input;
  const [row] = await db
    .insert(tenants)
    .values({
      name: i.name,
      slug: i.slug ?? generateSlug(),
      plan: i.plan ?? "free",
    })
    .returning();

  // Sandbox provisioning — plan Unit 6.
  //
  // Per memory `feedback_avoid_fire_and_forget_lambda_invokes` the invoke
  // itself uses RequestResponse (inside invokeProvisionTenantSandbox). But
  // we deliberately swallow the exception here: the tenant row is already
  // durable, the agent can sign in without sandbox, and the reconciler
  // (plan Unit 6 follow-up) sweeps rows with null sandbox_interpreter_*_id
  // at its own cadence. Failing the mutation would make a sandbox outage
  // into a tenant-onboarding outage — exactly what R-Q10 (interpreter-ready
  // gate independent of sandbox_enabled) is structured to avoid.
  try {
    await invokeProvisionTenantSandbox({ tenantId: row.id });
  } catch (err) {
    if (err instanceof SandboxProvisioningConfigError) {
      console.warn(
        `[createTenant] sandbox provisioning skipped (config missing): ${err.message}`,
      );
    } else {
      console.error(
        `[createTenant] sandbox provisioning failed for tenant ${row.id}:`,
        err,
      );
    }
  }

  return snakeToCamel(row);
};
