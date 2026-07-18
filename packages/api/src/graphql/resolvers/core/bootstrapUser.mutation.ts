/**
 * bootstrapUser — auto-provision a tenant + user on first sign-in.
 *
 * Called by the admin UI when `me` returns null after Cognito authentication.
 * Creates:
 *   1. User record (from Cognito JWT claims)
 *   2. Tenant record (auto-named from email domain or user name)
 *   3. TenantMember linking the two
 *   4. Default agent template
 *
 * Idempotent: if the user already exists, returns the existing records.
 */

import { getConfig } from "@thinkwork/runtime-config";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  tenants,
  users,
  tenantMembers,
  tenantSettings,
  agentTemplates,
} from "../../utils.js";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { ensureTenantBootstrapDefaults } from "../../../lib/tenant-bootstrap-defaults.js";
import { ensureDefaultThreadSpace } from "../../../lib/spaces/default-space.js";
import { validateTenantSlug } from "./tenantSlugValidation.js";
import { resolveCallerFromAuth } from "./resolve-auth-user.js";
import { userAuthIdentities } from "@thinkwork/database-pg/schema";

async function seedTenantBootstrapDefaults(tenantId: string, userId: string) {
  try {
    await ensureTenantBootstrapDefaults({ tenantId, userId });
  } catch (err) {
    console.warn(
      "[bootstrapUser] Failed to seed tenant bootstrap defaults:",
      err,
    );
  }
}

/**
 * A tenant with zero spaces dead-ends the composer ("You need access to a
 * workspace before starting work") — the only other creators are operators
 * in Settings → Spaces and addManualUser's invite path. Seed the same
 * default General space for tenants bootstrapUser creates or claims, so the
 * first sign-in lands in a working composer. Warn-only: a failed seed must
 * not fail the bootstrap (the operator can still create a space by hand).
 */
async function seedDefaultThreadSpace(tenantId: string, userId: string) {
  try {
    await ensureDefaultThreadSpace({ tenantId, userId });
  } catch (err) {
    console.warn("[bootstrapUser] Failed to seed the default space:", err);
  }
}

export const bootstrapUser = async (
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) => {
  if (!ctx.auth.principalId || !ctx.auth.email) {
    throw new Error("Authentication required");
  }

  const cognitoSub = ctx.auth.principalId;
  const email = ctx.auth.email;
  const name = (ctx.auth as any).name || email.split("@")[0];

  if (
    ctx.auth.authType !== "cognito" ||
    !ctx.auth.route ||
    !ctx.auth.cognitoIssuer
  ) {
    throw new Error("Cognito route admission is required");
  }

  // Existing users are returned only through an exact active identity,
  // connection, policy, and membership admission. Email can never select an
  // existing account for a newly presented provider subject.
  const admitted = await resolveCallerFromAuth(ctx.auth);
  const [existingUser] = admitted.userId
    ? await db
        .select()
        .from(users)
        .where(eq(users.id, admitted.userId))
        .limit(1)
    : [];

  if (existingUser) {
    // User exists — return existing data
    const [tenant] = existingUser.tenant_id
      ? await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, existingUser.tenant_id))
          .limit(1)
      : [];

    if (existingUser.tenant_id) {
      await seedTenantBootstrapDefaults(
        existingUser.tenant_id,
        existingUser.id,
      );
    }

    return {
      user: existingUser,
      tenant: tenant || null,
      isNew: false,
    };
  }

  if (ctx.auth.route.providerKind !== "local") {
    throw new Error(
      "Identity enrollment is required before a federated account can create or claim a workspace.",
    );
  }

  // A local Cognito sign-up may create a new account, but it may not capture
  // an existing row that happens to share its email.
  const [emailCandidate] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (emailCandidate) {
    throw new Error(
      "Identity enrollment is required for this existing account.",
    );
  }

  // A local Cognito sign-up may create a fresh free-tier workspace. Paid and
  // deploy-provisioned owners must consume an exact enrollment instead of
  // selecting an account or tenant by email.
  const tenantName = `${name}'s Workspace`;
  const tenantSlug = generateSlug();

  // Same validation path as createTenant/renameTenantSlug (plan
  // 2026-06-12-002 U5): even generated slugs must clear the reserved list
  // and the customer-domain namespace check before a tenant row exists.
  await validateTenantSlug(tenantSlug);

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: tenantName,
      slug: tenantSlug,
      plan: "free",
      issue_prefix: "TW",
      issue_counter: 0,
    })
    .returning();

  // Create tenant settings
  await db
    .insert(tenantSettings)
    .values({
      tenant_id: tenant.id,
      default_model: "us.anthropic.claude-sonnet-4-6",
    })
    .onConflictDoNothing();

  // Create user
  const [user] = await db
    .insert(users)
    .values({
      tenant_id: tenant.id,
      email,
      name,
      workspace_folder_name: workspaceFolderName(name, [], "user"),
      // Stable identity link captured at creation (see paid-path note above).
      cognito_sub: cognitoSub,
    })
    .returning();

  // Create tenant member (owner)
  await db.insert(tenantMembers).values({
    tenant_id: tenant.id,
    principal_type: "user",
    principal_id: user.id,
    role: "owner",
    status: "active",
  });

  await activateLocalIdentity(ctx, tenant.id, user.id);

  // Create default agent template
  await db
    .insert(agentTemplates)
    .values({
      tenant_id: tenant.id,
      name: "Default",
      slug: "default",
      model: "us.anthropic.claude-sonnet-4-6",
      config: {},
    })
    .onConflictDoNothing();

  await seedTenantBootstrapDefaults(tenant.id, user.id);
  await seedDefaultThreadSpace(tenant.id, user.id);

  // Update Cognito user with tenant_id (for future token claims)
  try {
    const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } =
      await import("@aws-sdk/client-cognito-identity-provider");
    const cognito = new CognitoIdentityProviderClient({});
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId:
          getConfig("COGNITO_USER_POOL_ID") || process.env.USER_POOL_ID,
        Username: cognitoSub,
        UserAttributes: [{ Name: "custom:tenant_id", Value: tenant.id }],
      }),
    );
  } catch (err) {
    console.warn("[bootstrapUser] Failed to update Cognito tenant_id:", err);
  }

  return {
    user,
    tenant,
    isNew: true,
  };
};

async function activateLocalIdentity(
  ctx: GraphQLContext,
  tenantId: string,
  userId: string,
): Promise<void> {
  const route = ctx.auth.route;
  if (!route || !ctx.auth.principalId || !ctx.auth.cognitoIssuer) {
    throw new Error("Cognito identity evidence is incomplete");
  }
  await db
    .insert(userAuthIdentities)
    .values({
      tenant_id: tenantId,
      user_id: userId,
      auth_provider_resource_id: route.connectionId,
      cognito_issuer: ctx.auth.cognitoIssuer,
      cognito_sub: ctx.auth.principalId,
      provider_issuer: ctx.auth.cognitoIssuer,
      provider_subject: ctx.auth.principalId,
      status: "active",
      proof_kind: "local_cognito_signup",
      evidence: {
        appClientId: route.appClientId,
        connectionKey: route.connectionKey,
      },
      activated_at: new Date(),
    })
    .onConflictDoNothing();
}
