/**
 * Workspace-member provisioning via the invite-token flow (plan U4, KTD4).
 *
 * As the admin user: sendInvitations(emails) → read the personal invite tokens
 * back → signUpInWorkspace(email, password, workspaceId, token) per rep with
 * the shared test password (R5, value from env — never in the repo). Email
 * delivery is irrelevant, which neutralizes TEI's SES sandbox.
 *
 * The auth/invitation mutations live on Twenty's core schema, which requires a
 * logged-in user token (UserAuthGuard) — the workspace API key is not enough.
 */

import { TwentyClient, TwentyGraphqlError } from "./twenty-client";

export interface RepToProvision {
  /** LastMile sales_rep.id — the value owner refs on CRM rows point at. */
  repId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  archived: boolean;
}

export interface WorkspaceMember {
  id: string;
  userEmail: string;
}

const WORKSPACE_MEMBERS_QUERY = `
  query MigrationWorkspaceMembers($after: String) {
    workspaceMembers(first: 200, after: $after) {
      edges { node { id userEmail } cursor }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function listWorkspaceMembers(
  client: TwentyClient,
): Promise<WorkspaceMember[]> {
  const members: WorkspaceMember[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      workspaceMembers: {
        edges: Array<{ node: WorkspaceMember }>;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await client.requestWithRetry(
      "/graphql",
      WORKSPACE_MEMBERS_QUERY,
      after ? { after } : {},
    );
    members.push(...data.workspaceMembers.edges.map((edge) => edge.node));
    if (!data.workspaceMembers.pageInfo.hasNextPage) break;
    after = data.workspaceMembers.pageInfo.endCursor;
  }
  return members;
}

/**
 * Obtain an admin user access token via password sign-in on the core schema.
 * Twenty's flow is getLoginTokenFromCredentials → getAuthTokensFromLoginToken.
 */
export async function adminSignIn(options: {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; workspaceId: string | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = options.baseUrl;

  async function core<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetchImpl(`${options.baseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw new TwentyGraphqlError(
        `Twenty core auth errors: ${JSON.stringify(body.errors)}`,
        {
          errors: body.errors,
        },
      );
    }
    if (!body.data)
      throw new TwentyGraphqlError("Twenty core auth returned no data.");
    return body.data;
  }

  const loginData = await core<{
    getLoginTokenFromCredentials: { loginToken: { token: string } };
  }>(
    `mutation MigrationLogin($email: String!, $password: String!, $origin: String!) {
      getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) {
        loginToken { token }
      }
    }`,
    { email: options.email, password: options.password, origin },
  );

  const tokensData = await core<{
    getAuthTokensFromLoginToken: {
      tokens: { accessOrWorkspaceAgnosticToken: { token: string } };
    };
  }>(
    `mutation MigrationAuthTokens($loginToken: String!, $origin: String!) {
      getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
        tokens { accessOrWorkspaceAgnosticToken { token } }
      }
    }`,
    {
      loginToken: loginData.getLoginTokenFromCredentials.loginToken.token,
      origin,
    },
  );

  const accessToken =
    tokensData.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken
      .token;
  // The workspaceId claim rides inside the JWT payload.
  let workspaceId: string | null = null;
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
    ) as { workspaceId?: string };
    workspaceId = payload.workspaceId ?? null;
  } catch {
    workspaceId = null;
  }
  return { accessToken, workspaceId };
}

export interface MemberProvisionReportRow {
  repId: string;
  email: string | null;
  action:
    | "existing"
    | "invited+signedUp"
    | "unprovisionable"
    | "failed"
    | "planned"
    | "merged-duplicate-email";
  error?: string;
}

export interface MembersEnsureResult {
  /** LastMile rep id → Twenty workspaceMemberId, for owner resolution (R6). */
  ownerMap: Map<string, string>;
  report: MemberProvisionReportRow[];
  /** True when any rep failed to provision (partial-failure exit code, U4). */
  hadFailures: boolean;
}

export interface MembersEnsureOptions {
  dataClient: TwentyClient;
  /** Client authed with the ADMIN USER token; required only when applying. */
  adminClient: TwentyClient | null;
  reps: RepToProvision[];
  repPassword: string;
  workspaceId: string | null;
  dryRun: boolean;
}

export async function ensureMembers(
  options: MembersEnsureOptions,
): Promise<MembersEnsureResult> {
  const { dataClient, adminClient, reps, repPassword, workspaceId, dryRun } =
    options;
  const report: MemberProvisionReportRow[] = [];
  const ownerMap = new Map<string, string>();
  let hadFailures = false;

  // Duplicate emails across reps collapse into ONE login: email is the login
  // identity (Twenty cannot hold two members with one email), so every rep id
  // sharing the email maps to the same workspace member. Observed live: a
  // "house" sales_rep row reusing a real rep's email. The merge is reported
  // per secondary rep so it is visible, never silent.
  const primaryRepByEmail = new Map<string, RepToProvision>();
  const mergedReps: RepToProvision[] = [];
  for (const rep of reps) {
    if (!rep.email) continue;
    const primary = primaryRepByEmail.get(rep.email);
    if (!primary) primaryRepByEmail.set(rep.email, rep);
    else mergedReps.push(rep);
  }

  const existingMembers = await listWorkspaceMembers(dataClient);
  const membersByEmail = new Map(
    existingMembers.map((member) => [member.userEmail.toLowerCase(), member]),
  );

  const mergedRepIds = new Set(mergedReps.map((rep) => rep.repId));
  const toInvite: RepToProvision[] = [];
  for (const rep of reps) {
    if (!rep.email) {
      report.push({ repId: rep.repId, email: null, action: "unprovisionable" });
      continue;
    }
    if (mergedRepIds.has(rep.repId)) continue; // resolved after primaries below
    const existing = membersByEmail.get(rep.email);
    if (existing) {
      ownerMap.set(rep.repId, existing.id);
      report.push({ repId: rep.repId, email: rep.email, action: "existing" });
      continue;
    }
    toInvite.push(rep);
  }

  const resolveMergedReps = () => {
    for (const rep of mergedReps) {
      const primary = primaryRepByEmail.get(
        rep.email as string,
      ) as RepToProvision;
      const memberId = ownerMap.get(primary.repId);
      if (memberId) ownerMap.set(rep.repId, memberId);
      report.push({
        repId: rep.repId,
        email: rep.email,
        action: "merged-duplicate-email",
      });
    }
  };

  if (dryRun) {
    for (const rep of toInvite) {
      report.push({ repId: rep.repId, email: rep.email, action: "planned" });
    }
    resolveMergedReps();
    return { ownerMap, report, hadFailures };
  }

  if (toInvite.length > 0) {
    if (!adminClient) {
      throw new Error(
        "Provisioning new members requires TWENTY_ADMIN_EMAIL/TWENTY_ADMIN_PASSWORD (admin user token).",
      );
    }
    if (!workspaceId) {
      throw new Error(
        "workspaceId could not be resolved from the admin session; set TWENTY_WORKSPACE_ID.",
      );
    }

    await adminClient.requestOnce(
      "/graphql",
      `mutation MigrationInvite($emails: [String!]!) {
        sendInvitations(emails: $emails) {
          success
          result { id email }
        }
      }`,
      { emails: toInvite.map((rep) => rep.email) },
    );

    const invitationsData = await adminClient.requestWithRetry<{
      findWorkspaceInvitations: Array<{ id: string; email: string }>;
    }>(
      "/graphql",
      `query MigrationInvitations {
        findWorkspaceInvitations { id email }
      }`,
    );

    // The personal invite token is read back per invitation.
    for (const rep of toInvite) {
      try {
        const invitation = invitationsData.findWorkspaceInvitations.find(
          (candidate) => candidate.email.toLowerCase() === rep.email,
        );
        if (!invitation) {
          throw new Error(
            `no invitation found for ${rep.email} after sendInvitations`,
          );
        }
        const tokenData = await adminClient.requestWithRetry<{
          getWorkspaceInvitationToken: { token: string } | string;
        }>(
          "/graphql",
          `query MigrationInviteToken($invitationId: String!) {
            getWorkspaceInvitationToken(invitationId: $invitationId)
          }`,
          { invitationId: invitation.id },
        );
        const rawToken = tokenData.getWorkspaceInvitationToken;
        const inviteToken =
          typeof rawToken === "string" ? rawToken : rawToken.token;

        await signUpRepInWorkspace({
          baseUrl: dataClient.endpoint("/graphql").replace(/\/graphql$/, ""),
          email: rep.email as string,
          password: repPassword,
          workspaceId,
          inviteToken,
        });
        // Membership materializes after signup; resolve the member id.
        const refreshed = await listWorkspaceMembers(dataClient);
        const member = refreshed.find(
          (candidate) => candidate.userEmail.toLowerCase() === rep.email,
        );
        if (!member)
          throw new Error(`member for ${rep.email} not visible after signup`);
        ownerMap.set(rep.repId, member.id);
        report.push({
          repId: rep.repId,
          email: rep.email,
          action: "invited+signedUp",
        });
      } catch (error) {
        hadFailures = true;
        report.push({
          repId: rep.repId,
          email: rep.email,
          action: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  resolveMergedReps();
  return { ownerMap, report, hadFailures };
}

async function signUpRepInWorkspace(options: {
  baseUrl: string;
  email: string;
  password: string;
  workspaceId: string;
  inviteToken: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `mutation MigrationSignUp(
        $email: String!
        $password: String!
        $workspaceId: String!
        $workspacePersonalInviteToken: String
      ) {
        signUpInWorkspace(
          email: $email
          password: $password
          workspaceId: { id: $workspaceId }
          workspacePersonalInviteToken: $workspacePersonalInviteToken
        ) {
          loginToken { token }
        }
      }`,
      variables: {
        email: options.email,
        password: options.password,
        workspaceId: options.workspaceId,
        workspacePersonalInviteToken: options.inviteToken,
      },
    }),
  });
  const body = (await response.json()) as {
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new TwentyGraphqlError(
      `signUpInWorkspace failed: ${JSON.stringify(body.errors)}`,
      {
        errors: body.errors,
      },
    );
  }
}
