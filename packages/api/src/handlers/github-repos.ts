import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc } from "drizzle-orm";
import {
	codeFactoryRepos,
	codeFactoryJobs,
	codeFactoryRuns,
	githubAppInstallations,
} from "@thinkwork/database-pg/schema";
import { tenants } from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";
import {
	getOctokit,
	createTenantRepo,
	repoExists,
	commitFiles,
	type GitHubWorkspaceConfig,
} from "../../../lambda/github-workspace";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// PUT /api/github-repos/runs/:id
		const runUpdateMatch = path.match(
			/^\/api\/github-repos\/runs\/([^/]+)$/,
		);
		if (runUpdateMatch && method === "PUT") {
			return updateRun(runUpdateMatch[1], event);
		}

		// /api/github-repos/jobs/:id/runs
		const jobRunsMatch = path.match(
			/^\/api\/github-repos\/jobs\/([^/]+)\/runs$/,
		);
		if (jobRunsMatch) {
			const jobId = jobRunsMatch[1];
			if (method === "GET") return listRuns(jobId);
			if (method === "POST") return createRun(jobId, event);
			return error("Method not allowed", 405);
		}

		// /api/github-repos/repos/:id/jobs
		const repoJobsMatch = path.match(
			/^\/api\/github-repos\/repos\/([^/]+)\/jobs$/,
		);
		if (repoJobsMatch) {
			const repoId = repoJobsMatch[1];
			if (method === "GET") return listJobs(repoId);
			if (method === "POST") return createJob(repoId, event);
			return error("Method not allowed", 405);
		}

		// POST /api/github-repos/repos/provision — auto-create GitHub repo for tenant
		if (path === "/api/github-repos/repos/provision" && method === "POST") {
			return provisionRepo(event);
		}

		// /api/github-repos/repos
		if (path === "/api/github-repos/repos") {
			if (method === "GET") return listRepos(event);
			if (method === "POST") return createRepo(event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("GitHub repos handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

async function listRepos(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId =
		event.headers["x-tenant-id"] ||
		event.queryStringParameters?.tenantId;
	if (!tenantId) return error("tenantId is required");

	const rows = await db
		.select()
		.from(codeFactoryRepos)
		.where(eq(codeFactoryRepos.tenant_id, tenantId))
		.orderBy(desc(codeFactoryRepos.created_at));

	return json(rows);
}

async function createRepo(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.tenant_id) return error("tenant_id is required");
	if (!body.github_owner) return error("github_owner is required");
	if (!body.github_repo) return error("github_repo is required");

	const [repo] = await db
		.insert(codeFactoryRepos)
		.values({
			tenant_id: body.tenant_id,
			github_owner: body.github_owner,
			github_repo: body.github_repo,
			github_installation_id: body.github_installation_id,
			default_branch: body.default_branch,
			config: body.config,
		})
		.returning();

	return json(repo, 201);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

async function listJobs(
	repoId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(codeFactoryJobs)
		.where(eq(codeFactoryJobs.repo_id, repoId))
		.orderBy(desc(codeFactoryJobs.created_at));

	return json(rows);
}

async function createJob(
	repoId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.tenant_id) return error("tenant_id is required");
	if (!body.name) return error("name is required");
	if (!body.type) return error("type is required");

	const [job] = await db
		.insert(codeFactoryJobs)
		.values({
			repo_id: repoId,
			tenant_id: body.tenant_id,
			agent_id: body.agent_id,
			name: body.name,
			type: body.type,
			config: body.config,
		})
		.returning();

	return json(job, 201);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function listRuns(
	jobId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(codeFactoryRuns)
		.where(eq(codeFactoryRuns.job_id, jobId))
		.orderBy(desc(codeFactoryRuns.created_at));

	return json(rows);
}

async function createRun(
	jobId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.tenant_id) return error("tenant_id is required");

	const [run] = await db
		.insert(codeFactoryRuns)
		.values({
			job_id: jobId,
			tenant_id: body.tenant_id,
			status: body.status || "pending",
			commit_sha: body.commit_sha,
			branch: body.branch,
			started_at: body.started_at ? new Date(body.started_at) : undefined,
			metadata: body.metadata,
		})
		.returning();

	return json(run, 201);
}

// ---------------------------------------------------------------------------
// Repo Provisioning (PRD-29: AutoResearch)
// ---------------------------------------------------------------------------

const GITHUB_OWNER = "thinkwork-ai";

async function getGitHubConfig(tenantId: string): Promise<GitHubWorkspaceConfig | null> {
	const appId = process.env.GITHUB_APP_ID;
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
	if (!appId || !privateKey) return null;

	// Look up the GitHub App installation for this tenant
	const [installation] = await db
		.select()
		.from(githubAppInstallations)
		.where(
			and(
				eq(githubAppInstallations.tenant_id, tenantId),
				eq(githubAppInstallations.status, "active"),
			),
		)
		.limit(1);

	if (!installation) return null;

	return {
		appId,
		privateKey: privateKey.replace(/\\n/g, "\n"),
		installationId: installation.installation_id,
		owner: GITHUB_OWNER,
	};
}

async function provisionRepo(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.tenant_id) return error("tenant_id is required");

	// Get tenant slug for repo name
	const [tenant] = await db
		.select({ slug: tenants.slug })
		.from(tenants)
		.where(eq(tenants.id, body.tenant_id))
		.limit(1);
	if (!tenant?.slug) return error("Tenant not found", 404);

	const ghConfig = await getGitHubConfig(body.tenant_id);
	if (!ghConfig) return error("GitHub App not configured for this tenant", 400);

	const octokit = getOctokit(ghConfig);

	// Check if repo already exists
	const exists = await repoExists(octokit, GITHUB_OWNER, tenant.slug);
	if (exists) {
		// Ensure it's recorded in code_factory_repos
		const [existing] = await db
			.select()
			.from(codeFactoryRepos)
			.where(
				and(
					eq(codeFactoryRepos.github_owner, GITHUB_OWNER),
					eq(codeFactoryRepos.github_repo, tenant.slug),
				),
			)
			.limit(1);

		if (existing) {
			return json({ ok: true, repo: existing, created: false });
		}

		// Repo exists in GitHub but not in DB — record it
		const [repo] = await db
			.insert(codeFactoryRepos)
			.values({
				tenant_id: body.tenant_id,
				github_owner: GITHUB_OWNER,
				github_repo: tenant.slug,
				github_installation_id: ghConfig.installationId,
				default_branch: "main",
				status: "active",
			})
			.returning();
		return json({ ok: true, repo, created: false });
	}

	// Create the repo
	const { fullName, defaultBranch } = await createTenantRepo(
		octokit,
		GITHUB_OWNER,
		tenant.slug,
	);

	// Seed with initial README
	await commitFiles(octokit, GITHUB_OWNER, tenant.slug, defaultBranch, [
		{
			path: "README.md",
			content: `# ${tenant.slug}\n\nThinkwork agent workspaces for ${tenant.slug}.\n`,
		},
	], "chore: initialize workspace repository");

	// Record in DB
	const [repo] = await db
		.insert(codeFactoryRepos)
		.values({
			tenant_id: body.tenant_id,
			github_owner: GITHUB_OWNER,
			github_repo: tenant.slug,
			github_installation_id: ghConfig.installationId,
			default_branch: defaultBranch,
			status: "active",
		})
		.returning();

	return json({ ok: true, repo, created: true }, 201);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function updateRun(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = {};

	if (body.status !== undefined) updates.status = body.status;
	if (body.commit_sha !== undefined) updates.commit_sha = body.commit_sha;
	if (body.branch !== undefined) updates.branch = body.branch;
	if (body.error !== undefined) updates.error = body.error;
	if (body.metadata !== undefined) updates.metadata = body.metadata;
	if (body.started_at !== undefined)
		updates.started_at = new Date(body.started_at);
	if (body.completed_at !== undefined)
		updates.completed_at = new Date(body.completed_at);

	if (Object.keys(updates).length === 0) {
		return error("No valid fields to update");
	}

	const [updated] = await db
		.update(codeFactoryRuns)
		.set(updates)
		.where(eq(codeFactoryRuns.id, id))
		.returning();

	if (!updated) return notFound("Run not found");
	return json(updated);
}
