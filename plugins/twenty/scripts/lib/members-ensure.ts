/**
 * Resolve LastMile reps to existing Twenty workspace members (plan U4, R6).
 *
 * This module does NOT create members. TEI's Twenty does not serve the auth
 * GraphQL schema over its ALB — `sendInvitations`, `signUpInWorkspace`, and
 * `getLoginTokenFromCredentials` all return "Cannot query field" — so there is
 * no API path to create a user. Creation lives in
 * `scripts/provision-twenty-members.ts`, which writes to Twenty's Postgres
 * directly (superseding decision S5 in the plan). Run it before the migration.
 *
 * What remains here: list the workspace's members, match reps to them by email
 * (case-insensitive), collapse reps that share an email onto one login, and
 * emit the `repId -> workspaceMemberId` owner map.
 */

import type { TwentyClient } from "./twenty-client";

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

export interface MemberProvisionReportRow {
  repId: string;
  email: string | null;
  action:
    | "existing"
    | "unprovisionable"
    | "missing-member"
    | "merged-duplicate-email";
  error?: string;
}

export interface MembersEnsureResult {
  /** LastMile rep id → Twenty workspaceMemberId, for owner resolution (R6). */
  ownerMap: Map<string, string>;
  report: MemberProvisionReportRow[];
  /** Retained for the caller's exit-code contract; this module never fails a rep. */
  hadFailures: boolean;
  /** Reps with an email but no Twenty member yet — run provision-twenty-members.ts. */
  missingMembers: number;
}

export interface MembersEnsureOptions {
  dataClient: TwentyClient;
  reps: RepToProvision[];
}

export async function ensureMembers(
  options: MembersEnsureOptions,
): Promise<MembersEnsureResult> {
  const { dataClient, reps } = options;
  const report: MemberProvisionReportRow[] = [];
  const ownerMap = new Map<string, string>();

  // Duplicate emails across reps collapse into ONE login: email is the login
  // identity (Twenty cannot hold two members with one email), so every rep id
  // sharing the email maps to the same workspace member. Observed live: a
  // "house" sales_rep row reusing a real rep's email, and Sal Carrizales
  // duplicated. The merge is reported per secondary rep, never silent.
  const primaryRepByEmail = new Map<string, RepToProvision>();
  const mergedReps: RepToProvision[] = [];
  for (const rep of reps) {
    if (!rep.email) continue;
    const primary = primaryRepByEmail.get(rep.email);
    if (!primary) primaryRepByEmail.set(rep.email, rep);
    else mergedReps.push(rep);
  }
  const mergedRepIds = new Set(mergedReps.map((rep) => rep.repId));

  const existingMembers = await listWorkspaceMembers(dataClient);
  const membersByEmail = new Map(
    existingMembers.map((member) => [member.userEmail.toLowerCase(), member]),
  );

  for (const rep of reps) {
    if (!rep.email) {
      report.push({ repId: rep.repId, email: null, action: "unprovisionable" });
      continue;
    }
    if (mergedRepIds.has(rep.repId)) continue; // resolved from its primary below
    const existing = membersByEmail.get(rep.email);
    if (existing) {
      ownerMap.set(rep.repId, existing.id);
      report.push({ repId: rep.repId, email: rep.email, action: "existing" });
      continue;
    }
    // No member for this rep: provision-twenty-members.ts has not run, or the
    // rep is new since it did. Their records load with a null owner and heal on
    // the next run once the member exists.
    report.push({
      repId: rep.repId,
      email: rep.email,
      action: "missing-member",
    });
  }

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

  const missing = report.filter(
    (row) => row.action === "missing-member",
  ).length;
  return { ownerMap, report, hadFailures: false, missingMembers: missing };
}
