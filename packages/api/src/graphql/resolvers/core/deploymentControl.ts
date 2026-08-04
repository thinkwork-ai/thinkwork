import { getConfig } from "@thinkwork/runtime-config";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";

const sm = new SecretsManagerClient({});

export function deploymentControlConfig() {
  const stage = process.env.STAGE || "dev";
  return {
    tokenSecretId:
      process.env.DEPLOY_CONTROL_GITHUB_TOKEN_SECRET_ID ||
      `thinkwork/${stage}/github/deploy-token`,
    repository:
      process.env.DEPLOY_CONTROL_REPOSITORY || "thinkwork-ai/thinkwork",
    workflowFile:
      process.env.DEPLOY_CONTROL_WORKFLOW_FILE || "deploy.yml",
    ref: process.env.DEPLOY_CONTROL_REF || "main",
  };
}

export async function readGithubToken(secretId: string): Promise<string> {
  const response = await sm.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const raw = response.SecretString?.trim();
  if (!raw) {
    throw new GraphQLError("Deploy token secret is empty", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  try {
    const parsed = JSON.parse(raw) as {
      token?: unknown;
      github_token?: unknown;
    };
    const token = parsed.token ?? parsed.github_token;
    if (typeof token === "string" && token.trim()) return token.trim();
  } catch {
    // Plain-token secrets are accepted for operator convenience.
  }

  return raw;
}

export async function upsertGithubActionsVariable(args: {
  token: string;
  repository: string;
  name: string;
  value: string;
}) {
  const update = await githubRequest(args.token, args.repository, {
    method: "PATCH",
    path: `/actions/variables/${args.name}`,
    body: { name: args.name, value: args.value },
  });
  if (update.status !== 404) return;

  const create = await githubRequest(args.token, args.repository, {
    method: "POST",
    path: "/actions/variables",
    body: { name: args.name, value: args.value },
  });
  if (create.status === 409) {
    await githubRequest(args.token, args.repository, {
      method: "PATCH",
      path: `/actions/variables/${args.name}`,
      body: { name: args.name, value: args.value },
    });
  }
}

export async function dispatchDeployWorkflow(args: {
  token: string;
  repository: string;
  workflowFile: string;
  ref: string;
}) {
  await githubRequest(args.token, args.repository, {
    method: "POST",
    path: `/actions/workflows/${encodeURIComponent(args.workflowFile)}/dispatches`,
    body: { ref: args.ref },
  });
}

export async function githubRequest(
  token: string,
  repository: string,
  request: { method: string; path: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${request.path}`,
    {
      method: request.method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
    },
  );

  if (response.status === 204) return { status: response.status, body: null };
  const text = await response.text();
  const body = text ? parseJsonOrText(text) : null;
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    throw new GraphQLError(
      `GitHub deploy request failed (${response.status})`,
      {
        extensions: { code: "BAD_GATEWAY", response: body },
      },
    );
  }
  return { status: response.status, body };
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function requirePlatformOperator(
  ctx: GraphQLContext,
): Promise<void> {
  const allowlist = (getConfig("THINKWORK_PLATFORM_OPERATOR_EMAILS") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) {
    throw new GraphQLError(
      "Deployment control is not enabled: THINKWORK_PLATFORM_OPERATOR_EMAILS must be configured",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  const email = (ctx.auth as any)?.email?.toLowerCase?.();
  if (!email || !allowlist.includes(email)) {
    throw new GraphQLError(
      "Deployment control requires platform-operator role",
      { extensions: { code: "FORBIDDEN" } },
    );
  }
}
