import type { GraphQLContext } from "../../context.js";
import { db, eq, agentTemplates } from "../../utils.js";
import {
	S3Client,
	ListObjectsV2Command,
	DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
	region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});
const BUCKET = process.env.WORKSPACE_BUCKET || "";

export async function deleteAgentTemplate(_parent: any, args: any, _ctx: GraphQLContext) {
	// Fetch template to get tenant + slug for S3 cleanup
	const [agentTemplate] = await db
		.select({ tenant_id: agentTemplates.tenant_id, slug: agentTemplates.slug })
		.from(agentTemplates)
		.where(eq(agentTemplates.id, args.id));

	// Delete DB row
	const result = await db
		.delete(agentTemplates)
		.where(eq(agentTemplates.id, args.id))
		.returning({ id: agentTemplates.id });

	// Clean up S3 workspace files
	if (agentTemplate?.tenant_id && agentTemplate?.slug && BUCKET) {
		try {
			const { db: _db, eq: _eq, tenants } = await import("../../utils.js");
			const [tenant] = await _db.select({ slug: tenants.slug }).from(tenants).where(_eq(tenants.id, agentTemplate.tenant_id));
			if (tenant?.slug) {
				const prefix = `tenants/${tenant.slug}/agents/_catalog/${agentTemplate.slug}/`;
				let continuationToken: string | undefined;
				do {
					const list = await s3.send(
						new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken }),
					);
					const keys = (list.Contents || []).map((o) => ({ Key: o.Key! })).filter((k) => k.Key);
					if (keys.length > 0) {
						await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
					}
					continuationToken = list.NextContinuationToken;
				} while (continuationToken);
			}
		} catch (err) {
			console.warn(`[deleteAgentTemplate] Failed to clean up S3 files:`, err);
		}
	}

	return result.length > 0;
}
