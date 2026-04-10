/**
 * GitHub Workspace Utilities
 *
 * Octokit-based functions for managing agent workspaces in GitHub repos.
 * GitHub is the source of truth; S3 is a read-through cache synced via webhook.
 *
 * Repo layout: {org}/{tenantSlug}/agents/{agentSlug}/workspace/...
 */

import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import {
	GetObjectCommand,
	PutObjectCommand,
	ListObjectsV2Command,
	DeleteObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubWorkspaceConfig {
	appId: string;
	privateKey: string;
	installationId: number;
	owner: string; // GitHub org name
}

export interface CommitFileEntry {
	path: string; // relative to repo root, e.g. "agents/my-agent/workspace/SOUL.md"
	content: string;
}

export interface WorkspaceFile {
	path: string; // relative path within workspace/
	content: string;
}

export interface BranchInfo {
	name: string;
	sha: string;
}

export interface PRInfo {
	number: number;
	url: string;
	htmlUrl: string;
}

// ---------------------------------------------------------------------------
// Octokit Client Factory
// ---------------------------------------------------------------------------

let _cachedOctokit: Octokit | null = null;
let _cachedConfig: GitHubWorkspaceConfig | null = null;

/**
 * Create an authenticated Octokit instance using GitHub App installation auth.
 * Caches the client for reuse within the same Lambda invocation.
 */
export function getOctokit(config: GitHubWorkspaceConfig): Octokit {
	if (_cachedOctokit && _cachedConfig?.installationId === config.installationId) {
		return _cachedOctokit;
	}

	_cachedOctokit = new Octokit({
		authStrategy: createAppAuth,
		auth: {
			appId: config.appId,
			privateKey: config.privateKey,
			installationId: config.installationId,
		},
	});
	_cachedConfig = config;

	return _cachedOctokit;
}

// ---------------------------------------------------------------------------
// Repo Path Helpers
// ---------------------------------------------------------------------------

/** Construct the workspace prefix path within a GitHub repo */
export function workspacePath(agentSlug: string, filePath?: string): string {
	const base = `agents/${agentSlug}/workspace`;
	if (!filePath) return base;
	return `${base}/${filePath.replace(/^\/+/, "")}`;
}

// ---------------------------------------------------------------------------
// Repository Operations
// ---------------------------------------------------------------------------

/**
 * Create a new repository in the configured org for a tenant.
 * Returns the repo full name (e.g., "org/acme-corp").
 */
export async function createTenantRepo(
	octokit: Octokit,
	owner: string,
	tenantSlug: string,
	options?: { description?: string; isPrivate?: boolean },
): Promise<{ fullName: string; defaultBranch: string }> {
	const { data } = await octokit.repos.createInOrg({
		org: owner,
		name: tenantSlug,
		description: options?.description ?? `Maniflow workspace for ${tenantSlug}`,
		private: options?.isPrivate ?? true,
		auto_init: true, // Creates initial commit with README
		has_issues: false,
		has_projects: false,
		has_wiki: false,
	});

	return {
		fullName: data.full_name,
		defaultBranch: data.default_branch,
	};
}

/**
 * Check if a repository exists.
 */
export async function repoExists(
	octokit: Octokit,
	owner: string,
	repo: string,
): Promise<boolean> {
	try {
		await octokit.repos.get({ owner, repo });
		return true;
	} catch (err: any) {
		if (err.status === 404) return false;
		throw err;
	}
}

// ---------------------------------------------------------------------------
// File Operations (via GitHub Trees API for atomic multi-file commits)
// ---------------------------------------------------------------------------

/**
 * Read a single file from a repo. Returns null if not found.
 */
export async function readFile(
	octokit: Octokit,
	owner: string,
	repo: string,
	path: string,
	ref?: string,
): Promise<string | null> {
	try {
		const { data } = await octokit.repos.getContent({
			owner,
			repo,
			path,
			ref,
		});

		if ("content" in data && data.encoding === "base64") {
			return Buffer.from(data.content, "base64").toString("utf-8");
		}
		return null;
	} catch (err: any) {
		if (err.status === 404) return null;
		throw err;
	}
}

/**
 * List all files under a directory path in the repo.
 * Returns relative paths within that directory.
 */
export async function listFiles(
	octokit: Octokit,
	owner: string,
	repo: string,
	dirPath: string,
	ref?: string,
): Promise<string[]> {
	try {
		// Use the Git Trees API with recursive=true for efficiency
		const refToUse = ref || "main";
		const { data: refData } = await octokit.git.getRef({
			owner,
			repo,
			ref: `heads/${refToUse}`,
		});
		const commitSha = refData.object.sha;

		const { data: commit } = await octokit.git.getCommit({
			owner,
			repo,
			commit_sha: commitSha,
		});

		const { data: tree } = await octokit.git.getTree({
			owner,
			repo,
			tree_sha: commit.tree.sha,
			recursive: "true",
		});

		const prefix = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
		return tree.tree
			.filter((item) => item.type === "blob" && item.path?.startsWith(prefix))
			.map((item) => item.path!.slice(prefix.length));
	} catch (err: any) {
		if (err.status === 404) return [];
		throw err;
	}
}

/**
 * Read all workspace files for an agent.
 * Returns a map of relative path → content.
 */
export async function readWorkspaceFiles(
	octokit: Octokit,
	owner: string,
	repo: string,
	agentSlug: string,
	ref?: string,
): Promise<Record<string, string>> {
	const wsPath = workspacePath(agentSlug);
	const filePaths = await listFiles(octokit, owner, repo, wsPath, ref);

	const files: Record<string, string> = {};
	for (const relativePath of filePaths) {
		const fullPath = `${wsPath}/${relativePath}`;
		const content = await readFile(octokit, owner, repo, fullPath, ref);
		if (content !== null) {
			files[relativePath] = content;
		}
	}

	return files;
}

/**
 * Commit multiple files atomically using the Git Trees API.
 * This creates a single commit with all file changes.
 */
export async function commitFiles(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
	files: CommitFileEntry[],
	message: string,
): Promise<{ sha: string }> {
	// 1. Get the current commit SHA for the branch
	const { data: ref } = await octokit.git.getRef({
		owner,
		repo,
		ref: `heads/${branch}`,
	});
	const parentSha = ref.object.sha;

	// 2. Get the current tree
	const { data: parentCommit } = await octokit.git.getCommit({
		owner,
		repo,
		commit_sha: parentSha,
	});

	// 3. Create blobs for each file
	const treeItems = await Promise.all(
		files.map(async (file) => {
			const { data: blob } = await octokit.git.createBlob({
				owner,
				repo,
				content: Buffer.from(file.content, "utf-8").toString("base64"),
				encoding: "base64",
			});
			return {
				path: file.path,
				mode: "100644" as const,
				type: "blob" as const,
				sha: blob.sha,
			};
		}),
	);

	// 4. Create a new tree
	const { data: newTree } = await octokit.git.createTree({
		owner,
		repo,
		base_tree: parentCommit.tree.sha,
		tree: treeItems,
	});

	// 5. Create the commit
	const { data: newCommit } = await octokit.git.createCommit({
		owner,
		repo,
		message,
		tree: newTree.sha,
		parents: [parentSha],
	});

	// 6. Update the branch reference
	await octokit.git.updateRef({
		owner,
		repo,
		ref: `heads/${branch}`,
		sha: newCommit.sha,
	});

	return { sha: newCommit.sha };
}

// ---------------------------------------------------------------------------
// Branch Operations
// ---------------------------------------------------------------------------

/**
 * Create a new branch from a base ref (defaults to main).
 */
export async function createBranch(
	octokit: Octokit,
	owner: string,
	repo: string,
	branchName: string,
	baseBranch?: string,
): Promise<BranchInfo> {
	const base = baseBranch || "main";

	// Get the SHA of the base branch
	const { data: baseRef } = await octokit.git.getRef({
		owner,
		repo,
		ref: `heads/${base}`,
	});

	// Create new branch pointing to the same commit
	const { data: newRef } = await octokit.git.createRef({
		owner,
		repo,
		ref: `refs/heads/${branchName}`,
		sha: baseRef.object.sha,
	});

	return {
		name: branchName,
		sha: newRef.object.sha,
	};
}

/**
 * Reset a branch to a specific commit SHA (git revert equivalent).
 * Used by AutoResearch to discard a failed experiment.
 */
export async function resetBranch(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
	targetSha: string,
): Promise<void> {
	await octokit.git.updateRef({
		owner,
		repo,
		ref: `heads/${branch}`,
		sha: targetSha,
		force: true,
	});
}

/**
 * Get the current HEAD SHA of a branch.
 */
export async function getBranchHead(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
): Promise<string> {
	const { data: ref } = await octokit.git.getRef({
		owner,
		repo,
		ref: `heads/${branch}`,
	});
	return ref.object.sha;
}

/**
 * Check if a branch exists.
 */
export async function branchExists(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
): Promise<boolean> {
	try {
		await octokit.git.getRef({
			owner,
			repo,
			ref: `heads/${branch}`,
		});
		return true;
	} catch (err: any) {
		if (err.status === 404) return false;
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Pull Request Operations
// ---------------------------------------------------------------------------

/**
 * Create a pull request from an experiment branch to main.
 */
export async function createPR(
	octokit: Octokit,
	owner: string,
	repo: string,
	head: string,
	base: string,
	title: string,
	body: string,
): Promise<PRInfo> {
	const { data } = await octokit.pulls.create({
		owner,
		repo,
		title,
		body,
		head,
		base,
	});

	return {
		number: data.number,
		url: data.url,
		htmlUrl: data.html_url,
	};
}

/**
 * Merge a pull request using the specified merge method.
 */
export async function mergePR(
	octokit: Octokit,
	owner: string,
	repo: string,
	pullNumber: number,
	mergeMethod: "merge" | "squash" | "rebase" = "squash",
): Promise<{ sha: string; merged: boolean }> {
	const { data } = await octokit.pulls.merge({
		owner,
		repo,
		pull_number: pullNumber,
		merge_method: mergeMethod,
	});
	return { sha: data.sha, merged: data.merged };
}

// ---------------------------------------------------------------------------
// S3 Sync (GitHub → S3)
// ---------------------------------------------------------------------------

const s3Client = new S3Client({
	region: process.env.AWS_REGION || "us-east-1",
});

/**
 * Sync workspace files from a GitHub branch to S3.
 * Used after AutoResearch commits changes to an experiment branch,
 * so the eval runner reads the updated workspace from S3.
 */
export async function syncBranchToS3(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
	agentSlug: string,
	tenantSlug: string,
	bucket: string,
): Promise<{ filesSynced: number }> {
	const wsPath = workspacePath(agentSlug);
	const files = await readWorkspaceFiles(octokit, owner, repo, agentSlug, branch);

	let count = 0;
	for (const [relativePath, content] of Object.entries(files)) {
		const s3Key = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${relativePath}`;
		await s3Client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: s3Key,
				Body: content,
				ContentType: relativePath.endsWith(".json")
					? "application/json"
					: "text/plain; charset=utf-8",
			}),
		);
		count++;
	}

	// Regenerate manifest
	await regenerateS3Manifest(bucket, tenantSlug, agentSlug);

	return { filesSynced: count };
}

/**
 * Sync specific changed files from a GitHub push event to S3.
 * Called by the webhook handler when files are pushed to main.
 */
export async function syncPushToS3(
	octokit: Octokit,
	owner: string,
	repo: string,
	ref: string,
	changedFiles: string[],
	tenantSlug: string,
	bucket: string,
): Promise<{ filesSynced: number }> {
	// Filter to workspace files only: agents/{slug}/workspace/{path}
	const wsPattern = /^agents\/([^/]+)\/workspace\/(.+)$/;
	let count = 0;
	const affectedAgents = new Set<string>();

	for (const filePath of changedFiles) {
		const match = filePath.match(wsPattern);
		if (!match) continue;

		const [, agentSlug, relativePath] = match;
		affectedAgents.add(agentSlug);

		// Read file content from GitHub (it may have been deleted)
		const content = await readFile(octokit, owner, repo, filePath, ref);
		const s3Key = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${relativePath}`;

		if (content !== null) {
			await s3Client.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: s3Key,
					Body: content,
					ContentType: relativePath.endsWith(".json")
						? "application/json"
						: "text/plain; charset=utf-8",
				}),
			);
		} else {
			// File was deleted
			try {
				await s3Client.send(
					new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }),
				);
			} catch {
				// Ignore delete errors for non-existent keys
			}
		}
		count++;
	}

	// Regenerate manifests for affected agents
	for (const agentSlug of affectedAgents) {
		await regenerateS3Manifest(bucket, tenantSlug, agentSlug);
	}

	return { filesSynced: count };
}

/**
 * Regenerate the workspace manifest.json in S3.
 * Mirrors the logic from workspace-files.ts.
 */
async function regenerateS3Manifest(
	bucket: string,
	tenantSlug: string,
	agentSlug: string,
): Promise<void> {
	const prefix = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
	const files: { path: string; etag: string; size: number; last_modified: string }[] = [];
	let continuationToken: string | undefined;

	do {
		const result = await s3Client.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of result.Contents ?? []) {
			if (!obj.Key) continue;
			const relPath = obj.Key.slice(prefix.length);
			if (!relPath || relPath === "manifest.json") continue;
			files.push({
				path: relPath,
				etag: obj.ETag ?? "",
				size: obj.Size ?? 0,
				last_modified: obj.LastModified?.toISOString() ?? "",
			});
		}
		continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
	} while (continuationToken);

	const manifest = {
		version: 1,
		generated_at: new Date().toISOString(),
		files,
	};

	await s3Client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${prefix}manifest.json`,
			Body: JSON.stringify(manifest),
			ContentType: "application/json",
		}),
	);
}

// ---------------------------------------------------------------------------
// AutoResearch Workspace Helpers
// ---------------------------------------------------------------------------

/**
 * Commit workspace file changes for an AutoResearch experiment.
 * Writes changes to the experiment branch and syncs to S3.
 */
export async function commitExperiment(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
	agentSlug: string,
	tenantSlug: string,
	bucket: string,
	changes: { file: string; content: string }[],
	message: string,
): Promise<{ sha: string; filesSynced: number }> {
	// Convert workspace-relative paths to repo-absolute paths
	const commitEntries: CommitFileEntry[] = changes.map((change) => ({
		path: workspacePath(agentSlug, change.file),
		content: change.content,
	}));

	const { sha } = await commitFiles(octokit, owner, repo, branch, commitEntries, message);

	// Sync the branch to S3 so eval-runner reads the updated workspace
	const { filesSynced } = await syncBranchToS3(
		octokit,
		owner,
		repo,
		branch,
		agentSlug,
		tenantSlug,
		bucket,
	);

	return { sha, filesSynced };
}

/**
 * Revert an experiment by resetting the branch to a previous commit
 * and re-syncing S3 to match.
 */
export async function revertExperiment(
	octokit: Octokit,
	owner: string,
	repo: string,
	branch: string,
	targetSha: string,
	agentSlug: string,
	tenantSlug: string,
	bucket: string,
): Promise<{ filesSynced: number }> {
	await resetBranch(octokit, owner, repo, branch, targetSha);

	// Re-sync S3 from the reverted branch state
	const { filesSynced } = await syncBranchToS3(
		octokit,
		owner,
		repo,
		branch,
		agentSlug,
		tenantSlug,
		bucket,
	);

	return { filesSynced };
}

