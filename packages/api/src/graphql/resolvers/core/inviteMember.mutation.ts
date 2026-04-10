import {
	CognitoIdentityProviderClient,
	AdminCreateUserCommand,
	AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { GraphQLContext } from "../../context.js";
import {
	db,
	users,
	tenantMembers,
	snakeToCamel,
	eq,
	and,
} from "../../utils.js";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";

export const inviteMember = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { tenantId } = args;
	const { email, name, role } = args.input;

	// 1. Create the Cognito user (sends temp password email)
	let cognitoSub: string;
	try {
		const result = await cognito.send(
			new AdminCreateUserCommand({
				UserPoolId: USER_POOL_ID,
				Username: email,
				UserAttributes: [
					{ Name: "email", Value: email },
					{ Name: "email_verified", Value: "true" },
					...(name ? [{ Name: "name", Value: name }] : []),
					{ Name: "custom:tenant_id", Value: tenantId },
				],
				DesiredDeliveryMediums: ["EMAIL"],
			}),
		);
		cognitoSub = result.User?.Attributes?.find((a) => a.Name === "sub")?.Value || "";
		if (!cognitoSub) {
			throw new Error("Cognito did not return a sub for the created user");
		}
	} catch (err: any) {
		// If user already exists in Cognito, look up their sub
		if (err.name === "UsernameExistsException") {
			const existing = await cognito.send(
				new AdminGetUserCommand({
					UserPoolId: USER_POOL_ID,
					Username: email,
				}),
			);
			cognitoSub = existing.UserAttributes?.find((a) => a.Name === "sub")?.Value || "";
			if (!cognitoSub) {
				throw new Error("Could not resolve existing Cognito user sub");
			}
		} else {
			throw err;
		}
	}

	// 2. Upsert user row in DB
	const existingUser = await db.select().from(users).where(eq(users.id, cognitoSub));
	if (existingUser.length === 0) {
		await db.insert(users).values({
			id: cognitoSub,
			tenant_id: tenantId,
			email,
			name: name || null,
		});
	}

	// 3. Check if already a tenant member
	const existingMember = await db
		.select()
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, tenantId),
				eq(tenantMembers.principal_id, cognitoSub),
			),
		);
	if (existingMember.length > 0) {
		return snakeToCamel(existingMember[0]);
	}

	// 4. Add tenant member
	const [row] = await db
		.insert(tenantMembers)
		.values({
			tenant_id: tenantId,
			principal_type: "USER",
			principal_id: cognitoSub,
			role: role ?? "member",
			status: "active",
		})
		.returning();

	return snakeToCamel(row);
};
