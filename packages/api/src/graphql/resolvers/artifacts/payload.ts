import {
	artifactContentKey,
	isArtifactPayloadS3Key,
	readArtifactPayloadFromS3,
	writeArtifactPayloadToS3,
} from "../../../lib/artifacts/payload-storage.js";
import { artifactToCamel } from "../../utils.js";

type ArtifactRow = Record<string, unknown> & {
	id: string;
	tenant_id: string;
	type: string;
	content?: string | null;
	s3_key?: string | null;
};

export function artifactContentBelongsInPayloadStore(type: string): boolean {
	const normalizedType = type.toLowerCase();
	return normalizedType !== "applet" && normalizedType !== "applet_state";
}

export async function persistArtifactContentPayload(args: {
	tenantId: string;
	artifactId: string;
	content: string;
	type: string;
	revision?: string;
}): Promise<string | null> {
	if (!artifactContentBelongsInPayloadStore(args.type)) {
		return null;
	}

	const key = artifactContentKey({
		tenantId: args.tenantId,
		artifactId: args.artifactId,
		revision: args.revision,
	});
	await writeArtifactPayloadToS3({
		tenantId: args.tenantId,
		key,
		body: args.content,
		contentType: "text/markdown; charset=utf-8",
	});
	return key;
}

export async function artifactToCamelWithPayload(
	row: ArtifactRow,
): Promise<Record<string, unknown>> {
	if (
		row.s3_key &&
		artifactContentBelongsInPayloadStore(row.type) &&
		isArtifactPayloadS3Key(row.tenant_id, row.s3_key)
	) {
		return artifactToCamel({
			...row,
			content: await readArtifactPayloadFromS3({
				tenantId: row.tenant_id,
				key: row.s3_key,
			}),
		});
	}

	return artifactToCamel(row);
}
