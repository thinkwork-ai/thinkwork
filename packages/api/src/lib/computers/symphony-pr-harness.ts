import { and, eq, or } from "drizzle-orm";
import { getDb, type Database } from "@thinkwork/database-pg";
import {
  computerDelegations,
  computerEvents,
  connectorExecutions,
  connectors,
  messages,
  tenantCredentials,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import {
  moveLinearIssueToState,
  parseLinearIssueQueryConfig,
  postLinearIssueCommentOnce,
} from "../connectors/linear.js";
import { readTenantCredentialSecret } from "../tenant-credentials/secret-store.js";

type ConnectorWorkPayload = {
  connectorId: string;
  connectorExecutionId: string;
  externalRef: string;
  title: string;
  body: string;
  metadata: object | null;
};

export type SymphonyPrHarnessInput = {
  tenantId: string;
  computerId: string;
  taskId: string;
  delegationId: string;
  agentId: string;
  threadId: string;
  messageId: string;
  payload: ConnectorWorkPayload;
};

export type SymphonyPrHarnessResult =
  | { handled: false; reason: string }
  | {
      handled: true;
      branch: string;
      commitSha: string;
      prUrl: string;
      prNumber: number;
      threadTurnId: string;
      linear: {
        dispatchComment: unknown;
        prComment: unknown;
        reviewWriteback: unknown;
      };
    };

export type SymphonyPrHarnessDeps = {
  db?: Database;
  fetchImpl?: typeof fetch;
  readSecret?: (secretRef: string) => Promise<Record<string, unknown>>;
  now?: () => Date;
};

type GitHubRepoConfig = {
  owner: string;
  repo: string;
  baseBranch: string;
  filePath: string;
  credentialId?: string;
  credentialSlug?: string;
};

type GitHubContent = {
  content: string;
  sha?: string;
};

const DEFAULT_GITHUB_OWNER = "thinkwork-ai";
const DEFAULT_GITHUB_REPO = "thinkwork";
const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_FILE_PATH = "README.md";
const DEFAULT_GITHUB_CREDENTIAL_SLUG = "github";
const DEFAULT_REVIEW_STATE = "In Review";
const GITHUB_API = "https://api.github.com";

export async function runSymphonyPrConnectorWork(
  input: SymphonyPrHarnessInput,
  deps: SymphonyPrHarnessDeps = {},
): Promise<SymphonyPrHarnessResult> {
  const metadata = asRecord(input.payload.metadata);
  const linear = asRecord(metadata?.linear);
  const linearIdentifier = cleanString(linear?.identifier);
  if (!linearIdentifier) {
    return { handled: false, reason: "not_linear_connector_work" };
  }

  const db = deps.db ?? getDb();
  const now = deps.now ?? (() => new Date());
  const readSecret = deps.readSecret ?? readTenantCredentialSecret;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const connector = await loadConnector(
    db,
    input.tenantId,
    input.payload.connectorId,
  );
  if (connector.type !== "linear_tracker") {
    return { handled: false, reason: "not_linear_tracker" };
  }

  const config = asRecord(connector.config) ?? {};
  const linearQuery = parseLinearIssueQueryConfig(config);
  if (!linearQuery) {
    throw new Error("Linear connector credential config is required");
  }
  const linearApiKey = await loadCredentialValue(db, {
    tenantId: input.tenantId,
    credentialId: linearQuery.credentialId,
    credentialSlug: linearQuery.credentialSlug,
    readSecret,
    valueKeys: ["apiKey", "token"],
  });
  const repoConfig = parseGitHubRepoConfig(config);
  const githubToken = await loadCredentialValue(db, {
    tenantId: input.tenantId,
    credentialId: repoConfig.credentialId,
    credentialSlug: repoConfig.credentialSlug,
    readSecret,
    valueKeys: ["token", "accessToken", "apiKey"],
  });

  const branch = deterministicBranch(input, linearIdentifier);
  const runDetailUrl = symphonyRunsUrl();
  const dispatchMarker = `thinkwork:symphony:dispatch:${input.taskId}`;
  const prMarker = `thinkwork:symphony:pr:${input.taskId}`;
  const dispatchedComment = await postLinearIssueCommentOnce({
    apiKey: linearApiKey,
    issueId: input.payload.externalRef,
    body: dispatchedMessage({ branch, runDetailUrl }),
    dedupeMarker: dispatchMarker,
    fetchImpl,
  });

  await ensureBranch({
    token: githubToken,
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    branch,
    baseBranch: repoConfig.baseBranch,
    fetchImpl,
  });

  const existing = await readGitHubFile({
    token: githubToken,
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    path: repoConfig.filePath,
    ref: branch,
    fetchImpl,
  });
  const nextContent = upsertCheckpointSection(existing.content, {
    identifier: linearIdentifier,
    title: input.payload.title,
    url: cleanString(linear?.url),
    taskId: input.taskId,
  });
  const commit =
    existing.content === nextContent
      ? await getBranchHead({
          token: githubToken,
          owner: repoConfig.owner,
          repo: repoConfig.repo,
          branch,
          fetchImpl,
        })
      : await writeGitHubFile({
          token: githubToken,
          owner: repoConfig.owner,
          repo: repoConfig.repo,
          path: repoConfig.filePath,
          branch,
          content: nextContent,
          sha: existing.sha,
          message: `chore: handle ${linearIdentifier}`,
          fetchImpl,
        });
  const pr = await createOrReuseDraftPr({
    token: githubToken,
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    branch,
    baseBranch: repoConfig.baseBranch,
    title: `Symphony: ${linearIdentifier}`,
    body: prBody({
      identifier: linearIdentifier,
      title: input.payload.title,
      issueUrl: cleanString(linear?.url),
      threadId: input.threadId,
      connectorExecutionId: input.payload.connectorExecutionId,
    }),
    fetchImpl,
  });

  const prComment = await postLinearIssueCommentOnce({
    apiKey: linearApiKey,
    issueId: input.payload.externalRef,
    body: prOpenedMessage({ prUrl: pr.htmlUrl, runDetailUrl }),
    dedupeMarker: prMarker,
    fetchImpl,
  });
  const reviewStateName = parseReviewStateName(config);
  const reviewWriteback = await moveLinearIssueToState({
    apiKey: linearApiKey,
    issueId: input.payload.externalRef,
    stateName: reviewStateName,
    fetchImpl,
  });

  const completedAt = now();
  const result = {
    mode: "symphony_pr_harness",
    branch,
    commitSha: commit.sha,
    prUrl: pr.htmlUrl,
    prNumber: pr.number,
    repository: `${repoConfig.owner}/${repoConfig.repo}`,
    baseBranch: repoConfig.baseBranch,
    filePath: repoConfig.filePath,
    linear: {
      identifier: linearIdentifier,
      issueId: input.payload.externalRef,
      dispatchComment: dispatchedComment,
      prComment,
      reviewWriteback,
    },
  };

  const [turn] = await db
    .insert(threadTurns)
    .values({
      tenant_id: input.tenantId,
      agent_id: input.agentId,
      invocation_source: "connector_work",
      trigger_detail: `connector_execution:${input.payload.connectorExecutionId}`,
      thread_id: input.threadId,
      status: "succeeded",
      kind: "system_event",
      started_at: completedAt,
      finished_at: completedAt,
      result_json: result,
    })
    .returning({ id: threadTurns.id });
  if (!turn) throw new Error("Failed to record Symphony connector thread turn");

  await db.insert(messages).values({
    tenant_id: input.tenantId,
    thread_id: input.threadId,
    role: "assistant",
    content: `Draft PR opened for ${linearIdentifier}: ${pr.htmlUrl}`,
    sender_type: "computer",
    sender_id: input.computerId,
    metadata: {
      source: "symphony_pr_harness",
      taskId: input.taskId,
      delegationId: input.delegationId,
      threadTurnId: turn.id,
      branch,
      prUrl: pr.htmlUrl,
    },
  });

  const outputArtifacts = { ...result, threadTurnId: turn.id };
  await db
    .update(computerDelegations)
    .set({
      status: "completed",
      output_artifacts: outputArtifacts,
      result: outputArtifacts,
      error: null,
      completed_at: completedAt,
    })
    .where(eq(computerDelegations.id, input.delegationId));

  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    task_id: input.taskId,
    event_type: "connector_work_pr_opened",
    level: "info",
    payload: {
      delegationId: input.delegationId,
      threadTurnId: turn.id,
      branch,
      prUrl: pr.htmlUrl,
      connectorExecutionId: input.payload.connectorExecutionId,
    },
  });

  await updateConnectorExecutionOutcome(db, {
    tenantId: input.tenantId,
    executionId: input.payload.connectorExecutionId,
    branch,
    prUrl: pr.htmlUrl,
    prNumber: pr.number,
    commitSha: commit.sha,
    threadTurnId: turn.id,
    providerWriteback: {
      provider: "linear",
      action: "move_issue_state",
      status: reviewWriteback.updated ? "updated" : "skipped",
      reason: reviewWriteback.skippedReason ?? null,
      issueId: reviewWriteback.issueId,
      stateName: reviewWriteback.stateName,
      stateId: reviewWriteback.stateId ?? null,
      prUrl: pr.htmlUrl,
      branch,
    },
  });

  return {
    handled: true,
    branch,
    commitSha: commit.sha,
    prUrl: pr.htmlUrl,
    prNumber: pr.number,
    threadTurnId: turn.id,
    linear: {
      dispatchComment: dispatchedComment,
      prComment,
      reviewWriteback,
    },
  };
}

async function loadConnector(
  db: Database,
  tenantId: string,
  connectorId: string,
) {
  const [row] = await db
    .select()
    .from(connectors)
    .where(
      and(eq(connectors.tenant_id, tenantId), eq(connectors.id, connectorId)),
    )
    .limit(1);
  if (!row) throw new Error(`Connector ${connectorId} not found`);
  return row;
}

async function loadCredentialValue(
  db: Database,
  args: {
    tenantId: string;
    credentialId?: string;
    credentialSlug?: string;
    readSecret: (secretRef: string) => Promise<Record<string, unknown>>;
    valueKeys: string[];
  },
): Promise<string> {
  const credentialId = cleanString(args.credentialId);
  const credentialSlug = cleanString(args.credentialSlug);
  if (!credentialId && !credentialSlug) {
    throw new Error("Credential handle is required");
  }
  const handleConditions = [
    credentialId ? eq(tenantCredentials.id, credentialId) : undefined,
    credentialSlug ? eq(tenantCredentials.slug, credentialSlug) : undefined,
  ].filter(Boolean) as Array<ReturnType<typeof eq>>;
  const [credential] = await db
    .select({
      id: tenantCredentials.id,
      kind: tenantCredentials.kind,
      status: tenantCredentials.status,
      secret_ref: tenantCredentials.secret_ref,
    })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, args.tenantId),
        eq(tenantCredentials.status, "active"),
        handleConditions.length === 1
          ? handleConditions[0]!
          : or(...handleConditions),
      ),
    )
    .limit(1);
  if (!credential)
    throw new Error(`Credential ${credentialSlug ?? credentialId} not found`);

  const secret = await args.readSecret(credential.secret_ref);
  for (const key of args.valueKeys) {
    const value = cleanString(secret[key]);
    if (value) return value;
  }
  throw new Error(
    `Credential ${credentialSlug ?? credentialId} is missing a usable token`,
  );
}

function parseGitHubRepoConfig(
  config: Record<string, unknown>,
): GitHubRepoConfig {
  const workflow = asRecord(config.workflow) ?? {};
  const github = asRecord(config.github) ?? asRecord(workflow.github) ?? {};
  const repo = asRecord(github.repo) ?? asRecord(workflow.repo) ?? {};
  return {
    owner:
      cleanString(github.owner) ??
      cleanString(repo.owner) ??
      cleanString(config.githubOwner) ??
      DEFAULT_GITHUB_OWNER,
    repo:
      cleanString(github.repoName) ??
      cleanString(github.repository) ??
      cleanString(repo.name) ??
      cleanString(repo.repo) ??
      cleanString(config.githubRepo) ??
      DEFAULT_GITHUB_REPO,
    baseBranch:
      cleanString(github.baseBranch) ??
      cleanString(github.defaultBranch) ??
      cleanString(repo.defaultBranch) ??
      DEFAULT_BASE_BRANCH,
    filePath:
      cleanString(github.filePath) ??
      cleanString(workflow.filePath) ??
      cleanString(config.checkpointFilePath) ??
      DEFAULT_FILE_PATH,
    credentialId: cleanString(github.credentialId) ?? undefined,
    credentialSlug:
      cleanString(github.credentialSlug) ?? DEFAULT_GITHUB_CREDENTIAL_SLUG,
  };
}

function parseReviewStateName(config: Record<string, unknown>): string {
  const writeback = asRecord(config.writeback) ?? {};
  const moveOnPrOpened =
    asRecord(writeback.moveOnPrOpened) ??
    asRecord(writeback.moveOnPrOpen) ??
    {};
  return (
    cleanString(moveOnPrOpened.stateName) ??
    cleanString(writeback.onPrOpenedState) ??
    cleanString(config.onPrOpenedState) ??
    DEFAULT_REVIEW_STATE
  );
}

async function ensureBranch(args: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  fetchImpl: typeof fetch;
}) {
  const existing = await githubJson<{ object?: { sha?: string } }>(
    args,
    `/repos/${args.owner}/${args.repo}/git/ref/heads/${githubRef(args.branch)}`,
    { method: "GET", notFound: null },
  );
  if (existing) return existing.object?.sha ?? null;

  const base = await githubJson<{ object?: { sha?: string } }>(
    args,
    `/repos/${args.owner}/${args.repo}/git/ref/heads/${githubRef(args.baseBranch)}`,
    { method: "GET" },
  );
  const sha = base.object?.sha;
  if (!sha) throw new Error(`GitHub base branch ${args.baseBranch} has no SHA`);
  try {
    await githubJson(args, `/repos/${args.owner}/${args.repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${args.branch}`, sha },
    });
  } catch (error) {
    if (!String(error).includes("422")) throw error;
  }
  return sha;
}

async function getBranchHead(args: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  fetchImpl: typeof fetch;
}): Promise<{ sha: string }> {
  const ref = await githubJson<{ object?: { sha?: string } }>(
    args,
    `/repos/${args.owner}/${args.repo}/git/ref/heads/${githubRef(args.branch)}`,
    { method: "GET" },
  );
  const sha = ref.object?.sha;
  if (!sha) throw new Error(`GitHub branch ${args.branch} has no SHA`);
  return { sha };
}

async function readGitHubFile(args: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
  fetchImpl: typeof fetch;
}): Promise<GitHubContent> {
  const response = await githubJson<{
    content?: string;
    encoding?: string;
    sha?: string;
  }>(
    args,
    `/repos/${args.owner}/${args.repo}/contents/${githubPath(args.path)}?ref=${encodeURIComponent(args.ref)}`,
    { method: "GET", notFound: null },
  );
  if (!response?.content || response.encoding !== "base64")
    return { content: "" };
  return {
    content: Buffer.from(response.content, "base64").toString("utf8"),
    sha: response.sha,
  };
}

async function writeGitHubFile(args: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  content: string;
  sha?: string;
  message: string;
  fetchImpl: typeof fetch;
}): Promise<{ sha: string }> {
  const response = await githubJson<{ commit?: { sha?: string } }>(
    args,
    `/repos/${args.owner}/${args.repo}/contents/${githubPath(args.path)}`,
    {
      method: "PUT",
      body: {
        message: args.message,
        content: Buffer.from(args.content, "utf8").toString("base64"),
        branch: args.branch,
        ...(args.sha ? { sha: args.sha } : {}),
      },
    },
  );
  const sha = response.commit?.sha;
  if (!sha)
    throw new Error("GitHub file commit response did not include a SHA");
  return { sha };
}

async function createOrReuseDraftPr(args: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  fetchImpl: typeof fetch;
}): Promise<{ number: number; htmlUrl: string }> {
  const head = `${args.owner}:${args.branch}`;
  const existing = await githubJson<
    Array<{ number?: number; html_url?: string }>
  >(
    args,
    `/repos/${args.owner}/${args.repo}/pulls?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(args.baseBranch)}`,
    { method: "GET" },
  );
  const match = existing.find((pr) => pr.number && pr.html_url);
  if (match?.number && match.html_url) {
    return { number: match.number, htmlUrl: match.html_url };
  }

  const created = await githubJson<{ number?: number; html_url?: string }>(
    args,
    `/repos/${args.owner}/${args.repo}/pulls`,
    {
      method: "POST",
      body: {
        title: args.title,
        head: args.branch,
        base: args.baseBranch,
        body: args.body,
        draft: true,
      },
    },
  );
  if (!created.number || !created.html_url) {
    throw new Error("GitHub PR response did not include number and html_url");
  }
  return { number: created.number, htmlUrl: created.html_url };
}

async function githubJson<T>(
  auth: { token: string; fetchImpl: typeof fetch },
  path: string,
  options: {
    method: "GET" | "POST" | "PUT";
    body?: unknown;
    notFound?: null;
  },
): Promise<T> {
  const response = await auth.fetchImpl(`${GITHUB_API}${path}`, {
    method: options.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${auth.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 404 && options.notFound === null) {
    return null as T;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GitHub API ${options.method} ${path} failed with HTTP ${response.status} ${response.statusText}: ${text}`.trim(),
    );
  }
  return (await response.json()) as T;
}

function upsertCheckpointSection(
  content: string,
  args: {
    identifier: string;
    title: string;
    url?: string | null;
    taskId: string;
  },
): string {
  const markerStart = `<!-- thinkwork-symphony:${args.identifier}:start -->`;
  const markerEnd = `<!-- thinkwork-symphony:${args.identifier}:end -->`;
  const section = [
    markerStart,
    `## Symphony checkpoint: ${args.identifier}`,
    "",
    `- Linear issue: ${args.identifier}`,
    `- Title: ${args.title}`,
    args.url ? `- URL: ${args.url}` : null,
    `- Connector task: ${args.taskId}`,
    markerEnd,
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const pattern = new RegExp(
    `${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\n?`,
  );
  const trimmed = content.trimEnd();
  if (pattern.test(trimmed)) {
    return `${trimmed.replace(pattern, section).trimEnd()}\n`;
  }
  return `${trimmed ? `${trimmed}\n\n` : ""}${section}`;
}

async function updateConnectorExecutionOutcome(
  db: Database,
  args: {
    tenantId: string;
    executionId: string;
    branch: string;
    prUrl: string;
    prNumber: number;
    commitSha: string;
    threadTurnId: string;
    providerWriteback: Record<string, unknown>;
  },
) {
  const [execution] = await db
    .select({ outcome_payload: connectorExecutions.outcome_payload })
    .from(connectorExecutions)
    .where(
      and(
        eq(connectorExecutions.tenant_id, args.tenantId),
        eq(connectorExecutions.id, args.executionId),
      ),
    )
    .limit(1);
  const outcome = asRecord(execution?.outcome_payload) ?? {};
  await db
    .update(connectorExecutions)
    .set({
      outcome_payload: {
        ...outcome,
        dispatchWriteback: outcome.providerWriteback ?? null,
        providerWriteback: args.providerWriteback,
        symphony: {
          ...(asRecord(outcome.symphony) ?? {}),
          branch: args.branch,
          prUrl: args.prUrl,
          prNumber: args.prNumber,
          commitSha: args.commitSha,
          threadTurnId: args.threadTurnId,
        },
      },
    })
    .where(
      and(
        eq(connectorExecutions.tenant_id, args.tenantId),
        eq(connectorExecutions.id, args.executionId),
      ),
    );
}

function deterministicBranch(
  input: SymphonyPrHarnessInput,
  identifier: string,
) {
  const suffix = input.taskId.replace(/-/g, "").slice(0, 8);
  return `symphony/${slug(identifier)}/${suffix}`;
}

function dispatchedMessage(args: { branch: string; runDetailUrl: string }) {
  return [
    "\u{1F3BC} **Symphony agent is now working on this issue.**",
    "",
    `- Branch: \`${args.branch}\``,
    `- [Run details](${args.runDetailUrl})`,
    "",
    "_The agent is autonomous; the operator UI is the live feed._",
  ].join("\n");
}

function prOpenedMessage(args: { prUrl: string; runDetailUrl: string }) {
  return [
    "\u2705 **Symphony agent opened a draft PR for this issue.**",
    "",
    `- [Pull request](${args.prUrl})`,
    `- [Run details](${args.runDetailUrl})`,
    "",
    "_Review and merge when ready._",
  ].join("\n");
}

function prBody(args: {
  identifier: string;
  title: string;
  issueUrl?: string | null;
  threadId: string;
  connectorExecutionId: string;
}) {
  return [
    `Automated Symphony checkpoint for ${args.identifier}.`,
    "",
    `Linear issue: ${args.issueUrl ?? args.identifier}`,
    `Title: ${args.title}`,
    `ThinkWork thread: ${args.threadId}`,
    `Connector execution: ${args.connectorExecutionId}`,
  ].join("\n");
}

function symphonyRunsUrl() {
  const base =
    cleanString(process.env.ADMIN_URL) ?? "https://admin.thinkwork.ai";
  return `${base.replace(/\/$/, "")}/symphony?tab=runs`;
}

function githubPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function githubRef(ref: string) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
