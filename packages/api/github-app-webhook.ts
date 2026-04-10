/**
 * GitHub App Webhook Handler (PRD-29: AutoResearch)
 *
 * Receives GitHub webhook events and processes them:
 * - `push` events: sync changed workspace files from GitHub to S3
 * - All events: proxy to API handler for delivery logging
 */

import {
	getOctokit,
	syncPushToS3,
	type GitHubWorkspaceConfig,
} from "@thinkwork/lambda/github-workspace";

interface APIGatewayProxyEventV2 {
	headers?: Record<string, string | undefined>;
	body?: string | null;
	isBase64Encoded?: boolean;
	rawQueryString?: string;
}

interface APIGatewayProxyResultV2 {
	statusCode: number;
	headers?: Record<string, string>;
	body?: string;
}

function text(statusCode: number, body: string): APIGatewayProxyResultV2 {
	return {
		statusCode,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
		body,
	};
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
	return {
		statusCode,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

function normalizeBaseUrl(url: string) {
	return url.replace(/\/$/, "");
}

function getHeader(headers: Record<string, string | undefined> | undefined, name: string) {
	if (!headers) return undefined;
	const direct = headers[name];
	if (direct) return direct;
	const lower = name.toLowerCase();
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() === lower) return v;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Push Event Processing
// ---------------------------------------------------------------------------

interface PushPayload {
	ref: string;
	repository: {
		full_name: string;
		name: string;
		owner: { login: string };
		default_branch: string;
	};
	commits: Array<{
		added: string[];
		modified: string[];
		removed: string[];
	}>;
	installation?: { id: number };
}

/**
 * Extract all changed file paths from a push event payload.
 */
function extractChangedFiles(payload: PushPayload): string[] {
	const files = new Set<string>();
	for (const commit of payload.commits ?? []) {
		for (const f of commit.added ?? []) files.add(f);
		for (const f of commit.modified ?? []) files.add(f);
		for (const f of commit.removed ?? []) files.add(f);
	}
	return Array.from(files);
}

/**
 * Determine if a push event contains workspace file changes.
 */
function hasWorkspaceChanges(changedFiles: string[]): boolean {
	return changedFiles.some((f) => /^agents\/[^/]+\/workspace\//.test(f));
}

/**
 * Look up the tenant slug from the GitHub repo name via the database.
 * Maps code_factory_repos.github_repo → tenants.slug.
 */
async function lookupTenantSlug(githubOwner: string, githubRepo: string): Promise<string | null> {
	try {
		const { getDb } = await import("@thinkwork/database-pg");
		const { codeFactoryRepos, tenants } = await import("@thinkwork/database-pg/schema");
		const { eq, and } = await import("drizzle-orm");
		const db = getDb();

		const [repo] = await db
			.select({ tenantSlug: tenants.slug })
			.from(codeFactoryRepos)
			.innerJoin(tenants, eq(tenants.id, codeFactoryRepos.tenant_id))
			.where(and(eq(codeFactoryRepos.github_owner, githubOwner), eq(codeFactoryRepos.github_repo, githubRepo)))
			.limit(1);

		return repo?.tenantSlug || null;
	} catch (err) {
		console.warn("Failed to look up tenant slug from DB:", err);
		return null;
	}
}

async function handlePushEvent(payload: PushPayload): Promise<{ synced: boolean; filesSynced: number }> {
	const bucket = process.env.WORKSPACE_BUCKET;
	const appId = process.env.GITHUB_APP_ID;
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

	if (!bucket || !appId || !privateKey) {
		console.log("Push sync skipped: missing WORKSPACE_BUCKET, GITHUB_APP_ID, or GITHUB_APP_PRIVATE_KEY");
		return { synced: false, filesSynced: 0 };
	}

	const installationId = payload.installation?.id;
	if (!installationId) {
		console.log("Push sync skipped: no installation ID in payload");
		return { synced: false, filesSynced: 0 };
	}

	// Only sync pushes to the default branch (main)
	const defaultBranch = payload.repository.default_branch || "main";
	const pushBranch = payload.ref.replace("refs/heads/", "");
	if (pushBranch !== defaultBranch) {
		console.log(`Push sync skipped: push to ${pushBranch}, not ${defaultBranch}`);
		return { synced: false, filesSynced: 0 };
	}

	const changedFiles = extractChangedFiles(payload);
	if (!hasWorkspaceChanges(changedFiles)) {
		console.log("Push sync skipped: no workspace file changes");
		return { synced: false, filesSynced: 0 };
	}

	const owner = payload.repository.owner.login;
	const repo = payload.repository.name;

	// Look up tenant slug from DB (repo name ≠ tenant slug)
	const tenantSlug = await lookupTenantSlug(owner, repo);
	if (!tenantSlug) {
		console.log(`Push sync skipped: no tenant found for repo ${owner}/${repo}`);
		return { synced: false, filesSynced: 0 };
	}
	console.log(`Push sync: repo ${owner}/${repo} → tenant ${tenantSlug}`);

	const config: GitHubWorkspaceConfig = {
		appId,
		privateKey: privateKey.replace(/\\n/g, "\n"),
		installationId,
		owner,
	};

	const octokit = getOctokit(config);

	console.log(`Syncing ${changedFiles.length} changed files from ${owner}/${repo} to S3`);

	const result = await syncPushToS3(
		octokit,
		owner,
		repo,
		pushBranch,
		changedFiles,
		tenantSlug,
		bucket,
	);

	console.log(`Synced ${result.filesSynced} workspace files to S3`);
	return { synced: true, filesSynced: result.filesSynced };
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
	const githubEvent = getHeader(event.headers, "x-github-event") || "";
	const rawBody = event.body
		? event.isBase64Encoded
			? Buffer.from(event.body, "base64").toString("utf8")
			: event.body
		: "";

	// Process push events for workspace sync
	if (githubEvent === "push" && rawBody) {
		try {
			const payload: PushPayload = JSON.parse(rawBody);
			const result = await handlePushEvent(payload);
			if (result.synced) {
				// Also proxy to API for delivery logging (fire-and-forget)
				proxyToApi(event).catch((err) => {
					console.warn("Failed to proxy push event for logging:", err);
				});
				return jsonResponse(200, {
					ok: true,
					event: "push",
					filesSynced: result.filesSynced,
				});
			}
		} catch (err) {
			console.error("Push event processing failed:", err);
			// Fall through to proxy — don't block webhook delivery
		}
	}

	// Proxy all other events to API handler for logging
	return proxyToApi(event);
}

async function proxyToApi(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
	const apiUrl = process.env.API_URL || process.env.CONVEX_SITE_URL;
	if (!apiUrl) {
		return text(500, "Server is not configured (API_URL missing)");
	}

	const targetUrl = `${normalizeBaseUrl(apiUrl)}/api/github-app/webhook${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;

	const contentType = getHeader(event.headers, "content-type") || "application/json";
	const signature = getHeader(event.headers, "x-hub-signature-256") || "";
	const delivery = getHeader(event.headers, "x-github-delivery") || "";
	const githubEvent = getHeader(event.headers, "x-github-event") || "";

	const rawBody = event.body
		? event.isBase64Encoded
			? Buffer.from(event.body, "base64").toString("utf8")
			: event.body
		: "";

	let response: Response;
	try {
		response = await fetch(targetUrl, {
			method: "POST",
			headers: {
				"content-type": contentType,
				"x-hub-signature-256": signature,
				"x-github-delivery": delivery,
				"x-github-event": githubEvent,
			},
			body: rawBody,
		});
	} catch (error: unknown) {
		return text(
			502,
			`Unable to reach webhook service: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	}

	const bodyText = await response.text();
	return {
		statusCode: response.status,
		headers: {
			"Content-Type": response.headers.get("content-type") || "application/json",
			"Cache-Control": "no-store",
		},
		body: bodyText || (response.ok ? "OK" : "Request failed"),
	};
}
