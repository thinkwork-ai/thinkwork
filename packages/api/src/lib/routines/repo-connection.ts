/**
 * Tenant routine-repo connection validation (deterministic routines v1,
 * R2/KTD-8). A github_repo tenant credential is validated at save/rotate
 * time — repo reachable with the pasted fine-grained token AND the
 * configured branch exists — so a typo'd URL, revoked token, or missing
 * branch is rejected with an actionable error before anything is stored.
 *
 * v1 is deliberately GitHub-only (Key Decision); the executor and agent
 * commit flow share this URL convention.
 */

import { Octokit } from "@octokit/rest";
import { GraphQLError } from "graphql";

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface GithubRepoCredentialPayload {
  repoUrl: string;
  token: string;
  branch: string;
}

/**
 * Accepts https://github.com/<owner>/<repo>(.git), git@github.com:<owner>/<repo>(.git),
 * or bare <owner>/<repo>. Rejects non-GitHub hosts (v1 is GitHub-only).
 */
export function parseGithubRepoUrl(repoUrl: string): GithubRepoRef {
  const trimmed = repoUrl.trim().replace(/\.git$/, "");
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/,
    /^git@github\.com:([^/]+)\/([^/]+)$/,
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }
  throw new GraphQLError(
    "repoUrl must be a GitHub repository (https://github.com/<owner>/<repo>); other git hosts are not supported yet",
    { extensions: { code: "BAD_USER_INPUT" } },
  );
}

export type OctokitFactory = (token: string) => Octokit;

const defaultOctokitFactory: OctokitFactory = (token) =>
  new Octokit({ auth: token });

/**
 * Validates the connection end to end. Throws a GraphQLError with an
 * actionable message on any failure; returns the parsed ref on success.
 */
export async function validateGithubRepoConnection(
  payload: GithubRepoCredentialPayload,
  octokitFactory: OctokitFactory = defaultOctokitFactory,
): Promise<GithubRepoRef> {
  const ref = parseGithubRepoUrl(payload.repoUrl);
  const octokit = octokitFactory(payload.token);

  try {
    await octokit.repos.get({ owner: ref.owner, repo: ref.repo });
  } catch (err) {
    throw new GraphQLError(
      `Could not access ${ref.owner}/${ref.repo} with the provided token: ${describeGithubError(err)}`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  try {
    await octokit.repos.getBranch({
      owner: ref.owner,
      repo: ref.repo,
      branch: payload.branch,
    });
  } catch (err) {
    throw new GraphQLError(
      `Branch "${payload.branch}" not found in ${ref.owner}/${ref.repo}: ${describeGithubError(err)}`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  return ref;
}

function describeGithubError(err: unknown): string {
  const status = (err as { status?: number }).status;
  if (status === 401) return "the token was rejected (401)";
  if (status === 403) return "the token lacks access (403)";
  if (status === 404)
    return "not found (404) — check the URL and the token's repository access";
  return err instanceof Error ? err.message : String(err);
}
