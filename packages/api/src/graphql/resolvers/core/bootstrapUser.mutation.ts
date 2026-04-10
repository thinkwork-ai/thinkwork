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

import type { GraphQLContext } from "../../context.js";
import {
	db, eq, sql,
	tenants, users, tenantMembers, tenantSettings, agentTemplates,
} from "../../utils.js";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";

export const bootstrapUser = async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
	if (!ctx.auth.principalId || !ctx.auth.email) {
		throw new Error("Authentication required");
	}

	const cognitoSub = ctx.auth.principalId;
	const email = ctx.auth.email;
	const name = (ctx.auth as any).name || email.split("@")[0];

	// Check if user already exists
	const [existingUser] = await db
		.select()
		.from(users)
		.where(eq(users.email, email))
		.limit(1);

	if (existingUser) {
		// User exists — return existing data
		const [tenant] = existingUser.tenant_id
			? await db.select().from(tenants).where(eq(tenants.id, existingUser.tenant_id)).limit(1)
			: [];

		return {
			user: existingUser,
			tenant: tenant || null,
			isNew: false,
		};
	}

	// Create tenant
	const tenantName = `${name}'s Workspace`;
	const tenantSlug = generateSlug();

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
		})
		.onConflictDoNothing();

	// Create user
	const [user] = await db
		.insert(users)
		.values({
			tenant_id: tenant.id,
			email,
			name,
		})
		.returning();

	// Create tenant member (owner)
	await db
		.insert(tenantMembers)
		.values({
			tenant_id: tenant.id,
			principal_type: "user",
			principal_id: user.id,
			role: "owner",
			status: "active",
		});

	// Create default agent template
	await db
		.insert(agentTemplates)
		.values({
			tenant_id: tenant.id,
			name: "Default",
			slug: "default",
			model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
			config: {},
		})
		.onConflictDoNothing();

	// Update Cognito user with tenant_id (for future token claims)
	try {
		const { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } = await import("@aws-sdk/client-cognito-identity-provider");
		const cognito = new CognitoIdentityProviderClient({});
		await cognito.send(new AdminUpdateUserAttributesCommand({
			UserPoolId: process.env.COGNITO_USER_POOL_ID || process.env.USER_POOL_ID,
			Username: cognitoSub,
			UserAttributes: [
				{ Name: "custom:tenant_id", Value: tenant.id },
			],
		}));
	} catch (err) {
		console.warn("[bootstrapUser] Failed to update Cognito tenant_id:", err);
	}

	return {
		user,
		tenant,
		isNew: true,
	};
};
