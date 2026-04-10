import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
const BUCKET = process.env.WORKSPACE_BUCKET || "";

export const agentWorkspaces = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { agentId } = args as { agentId: string };

	// Look up agent to get tenant slug and agent slug
	const [agent] = await db
		.select({ id: agents.id, slug: agents.slug, tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, agentId));

	if (!agent) return [];

	// Get tenant slug
	const { tenants } = await import("../../utils.js");
	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, agent.tenant_id));

	if (!tenant?.slug || !agent.slug) return [];

	const prefix = `tenants/${tenant.slug}/agents/${agent.slug}/workspace/`;

	if (!BUCKET) return [];

	try {
		// List all files in workspace
		const listResult = await s3.send(new ListObjectsV2Command({
			Bucket: BUCKET,
			Prefix: prefix,
		}));

		const files = (listResult.Contents || []).map((obj) => {
			const key = obj.Key || "";
			return key.slice(prefix.length); // relative path
		});

		// Find workspace folders: {slug}/CONTEXT.md
		const contextFiles = files.filter((f) => f.match(/^[^/]+\/CONTEXT\.md$/));
		const workspaces = [];

		for (const cf of contextFiles) {
			const slug = cf.split("/")[0];
			try {
				const getResult = await s3.send(new GetObjectCommand({
					Bucket: BUCKET,
					Key: `${prefix}${cf}`,
				}));
				const text = await getResult.Body?.transformToString() || "";

				const nameMatch = text.match(/^#\s+(.+)$/m);
				const purposeMatch = text.match(/^##\s+What This Workspace Is\s*\n([\s\S]*?)(?=\n##|\n---|$)/m);

				workspaces.push({
					slug,
					name: nameMatch ? nameMatch[1].trim() : slug,
					purpose: purposeMatch ? purposeMatch[1].trim().split("\n")[0] : "",
				});
			} catch {
				workspaces.push({ slug, name: slug, purpose: "" });
			}
		}

		return workspaces;
	} catch (err) {
		console.error("[agentWorkspaces] S3 error:", err);
		return [];
	}
};
