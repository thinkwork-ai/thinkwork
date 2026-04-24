/**
 * Artifact reads — mirrors the artifact functions in
 * packages/skill-catalog/thinkwork-admin/scripts/operations/reads.py.
 */

import type { AdminOpsClient } from "./client.js";
import { ARTIFACT_FIELDS } from "./_fields.js";

export interface Artifact {
	id: string;
	tenantId: string;
	threadId: string | null;
	agentId: string | null;
	type: string;
	status: string;
	title: string;
	content: string | null;
	summary: string | null;
	s3Key: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
}

export interface ListArtifactsInput {
	tenantId: string;
	threadId?: string;
	agentId?: string;
	type?: string;
	status?: string;
	limit?: number;
}

export async function listArtifacts(
	client: AdminOpsClient,
	input: ListArtifactsInput,
): Promise<Artifact[]> {
	const data = await client.graphql<{ artifacts: Artifact[] }>(
		`query(
			$tenantId: ID!, $threadId: ID, $agentId: ID,
			$type: ArtifactType, $status: ArtifactStatus, $limit: Int
		) {
			artifacts(tenantId: $tenantId, threadId: $threadId, agentId: $agentId, type: $type, status: $status, limit: $limit) { ${ARTIFACT_FIELDS} }
		}`,
		input as unknown as Record<string, unknown>,
	);
	return data.artifacts ?? [];
}

export async function getArtifact(
	client: AdminOpsClient,
	id: string,
): Promise<Artifact | null> {
	const data = await client.graphql<{ artifact: Artifact | null }>(
		`query($id: ID!) { artifact(id: $id) { ${ARTIFACT_FIELDS} } }`,
		{ id },
	);
	return data.artifact;
}
