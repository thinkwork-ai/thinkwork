import type { GraphQLContext } from "../../context.js";
import {
	db, eq,
	artifacts,
} from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { artifactToCamelWithPayload } from "./payload.js";

export const artifact = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const [row] = await db.select().from(artifacts).where(eq(artifacts.id, args.id));
	if (!row) return null;
	await requireTenantMember(ctx, row.tenant_id);
	return artifactToCamelWithPayload(row);
};
