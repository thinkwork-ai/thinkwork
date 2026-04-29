import {
	GetObjectCommand,
	ListObjectsV2Command,
	S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import {
	agentTemplates,
	agents,
	db,
	tenants,
} from "../../../graphql/utils.js";
import { isBuiltinToolWorkspacePath } from "../../builtin-tool-slugs.js";
import type {
	ContextHit,
	ContextProviderDescriptor,
	ContextProviderResult,
} from "../types.js";

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const MAX_FILE_BYTES = 64_000;
const TEXT_EXTENSIONS = new Set([
	".md",
	".mdx",
	".txt",
	".json",
	".yaml",
	".yml",
	".toml",
	".ts",
	".tsx",
	".js",
	".jsx",
	".py",
]);

let s3: S3Client | null = null;

export function createWorkspaceFilesContextProvider(): ContextProviderDescriptor {
	return {
		id: "workspace-files",
		family: "workspace",
		displayName: "Workspace Files",
		defaultEnabled: true,
		supportedScopes: ["personal", "team", "auto"],
		async query(request): Promise<ContextProviderResult> {
			const target = await resolveTarget(request.caller);
			if (!target) {
				return {
					hits: [],
					status: {
						state: "skipped",
						reason: "agent, template, or tenant defaults target is required",
					},
				};
			}
			const bucket = process.env.WORKSPACE_BUCKET || "";
			if (!bucket) {
				return {
					hits: [],
					status: {
						state: "skipped",
						reason: "WORKSPACE_BUCKET is not configured",
					},
				};
			}

			const paths = await listPrefix(bucket, target.prefix);
			const searchablePaths = paths.filter(isSearchablePath);
			const query = normalizedQuery(request.query);
			const terms = queryTerms(query);
			const hits: ContextHit[] = [];
			for (const path of searchablePaths) {
				if (hits.length >= request.limit) break;
				const content = await readObject(bucket, target.key(path));
				const matchIndex = findMatchIndex(content, path, query, terms);
				if (matchIndex < 0) continue;
				const snippet = excerpt(content, matchIndex);
				hits.push({
					id: `workspace:${target.kind}:${path}`,
					providerId: "workspace-files",
					family: "workspace",
					title: path,
					snippet,
					score: scorePath(path, matchIndex),
					scope: request.scope,
					provenance: {
						label: target.label,
						sourceId: target.key(path),
						uri: `thinkwork://workspace/${target.kind}/${path}`,
						metadata: { targetKind: target.kind, targetLabel: target.label },
					},
					metadata: { path, targetKind: target.kind, targetLabel: target.label },
				});
			}

			return {
				hits,
				status: {
					reason: describeSearch(target, paths.length, searchablePaths.length),
				},
			};
		},
	};
}

type WorkspaceTarget = {
	kind: "agent" | "template" | "defaults";
	label: string;
	prefix: string;
	key(path: string): string;
};

async function resolveTarget(caller: {
	tenantId: string;
	agentId?: string | null;
	templateId?: string | null;
}): Promise<WorkspaceTarget | null> {
	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, caller.tenantId));
	if (!tenant?.slug) return null;

	if (caller.agentId) {
		const [agent] = await db
			.select({ slug: agents.slug, tenantId: agents.tenant_id })
			.from(agents)
			.where(and(eq(agents.id, caller.agentId), eq(agents.tenant_id, caller.tenantId)));
		if (!agent?.slug) return null;
		const prefix = `tenants/${tenant.slug}/agents/${agent.slug}/workspace/`;
		return {
			kind: "agent",
			label: `agent workspace ${agent.slug}`,
			prefix,
			key: (path) => `${prefix}${path.replace(/^\/+/, "")}`,
		};
	}

	if (caller.templateId) {
		const [template] = await db
			.select({ slug: agentTemplates.slug, tenantId: agentTemplates.tenant_id })
			.from(agentTemplates)
			.where(
				and(
					eq(agentTemplates.id, caller.templateId),
					eq(agentTemplates.tenant_id, caller.tenantId),
				),
			);
		if (!template?.slug) return null;
		const prefix = `tenants/${tenant.slug}/agents/_catalog/${template.slug}/workspace/`;
		return {
			kind: "template",
			label: `template workspace ${template.slug}`,
			prefix,
			key: (path) => `${prefix}${path.replace(/^\/+/, "")}`,
		};
	}

	const prefix = `tenants/${tenant.slug}/agents/_catalog/defaults/workspace/`;
	return {
		kind: "defaults",
		label: "tenant default workspace",
		prefix,
		key: (path) => `${prefix}${path.replace(/^\/+/, "")}`,
	};
}

async function listPrefix(bucket: string, prefix: string): Promise<string[]> {
	const client = getS3();
	const paths: string[] = [];
	let continuationToken: string | undefined;
	do {
		const page = await client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const object of page.Contents ?? []) {
			const size = object.Size ?? 0;
			if (!object.Key || size === 0 || size > MAX_FILE_BYTES) continue;
			paths.push(object.Key.slice(prefix.length));
		}
		continuationToken = page.NextContinuationToken;
	} while (continuationToken);
	return paths;
}

async function readObject(bucket: string, key: string): Promise<string> {
	const resp = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	return (await resp.Body?.transformToString("utf-8")) ?? "";
}

function getS3(): S3Client {
	if (!s3) s3 = new S3Client({ region: REGION });
	return s3;
}

function isSearchablePath(path: string): boolean {
	if (
		path === "manifest.json" ||
		path === "_defaults_version" ||
		isBuiltinToolWorkspacePath(path)
	) {
		return false;
	}
	const lower = path.toLowerCase();
	return [...TEXT_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

function excerpt(content: string, index: number): string {
	const start = Math.max(0, index - 80);
	const end = Math.min(content.length, index + 220);
	return content.slice(start, end).replace(/\s+/g, " ").trim();
}

function normalizedQuery(query: string): string {
	return query.trim().toLowerCase();
}

const QUERY_STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"for",
	"from",
	"in",
	"is",
	"of",
	"on",
	"the",
	"to",
	"with",
]);

function queryTerms(query: string): string[] {
	const terms = query.match(/[a-z0-9][a-z0-9_-]*/g) ?? [];
	return terms.filter((term) => term.length > 1 && !QUERY_STOPWORDS.has(term));
}

function findMatchIndex(
	content: string,
	path: string,
	query: string,
	terms: string[],
): number {
	const contentLower = content.toLowerCase();
	const exact = contentLower.indexOf(query);
	if (exact >= 0) return exact;

	const pathLower = path.toLowerCase();
	if (pathLower.includes(query)) return 0;
	if (terms.length === 0) return -1;

	const matchesAllTerms = terms.every(
		(term) => contentLower.includes(term) || pathLower.includes(term),
	);
	if (!matchesAllTerms) return -1;

	const contentTermIndexes = terms
		.map((term) => contentLower.indexOf(term))
		.filter((index) => index >= 0);
	return contentTermIndexes.length > 0 ? Math.min(...contentTermIndexes) : 0;
}

function describeSearch(
	target: WorkspaceTarget,
	totalFiles: number,
	searchableFiles: number,
): string {
	return `searched ${searchableFiles}/${totalFiles} files in ${target.label}`;
}

function scorePath(path: string, index: number): number {
	if (index === 0) return 1;
	if (path.toLowerCase().includes("agents.md") || path.toLowerCase().includes("context")) {
		return 0.85;
	}
	return 0.65;
}
