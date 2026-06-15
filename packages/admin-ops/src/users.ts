/**
 * User + tenant-member reads and member invite resend operations. Mirrors the
 * me/get_user/list_tenant_members legacy thinkwork-admin skill read helpers.
 */

import { randomUUID } from "node:crypto";
import type { AdminOpsClient } from "./client.js";
import { USER_FIELDS, TENANT_MEMBER_FIELDS } from "./_fields.js";

export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  name: string | null;
  image: string | null;
  phone: string | null;
  createdAt: string;
}

export interface TenantMember {
  id: string;
  tenantId: string;
  principalType: string;
  principalId: string;
  role: string;
  status: string;
  cognitoStatus: string | null;
  createdAt: string;
}

export type ResendMemberInviteStatus =
  | "RESENT"
  | "NOT_PENDING"
  | "DELIVERY_FAILED";

export interface ResendMemberInviteResult {
  status: ResendMemberInviteStatus;
  message: string;
}

export async function me(client: AdminOpsClient): Promise<User | null> {
  const data = await client.graphql<{ me: User | null }>(
    `query { me { ${USER_FIELDS} } }`,
  );
  return data.me;
}

export async function getUser(
  client: AdminOpsClient,
  id: string,
): Promise<User | null> {
  const data = await client.graphql<{ user: User | null }>(
    `query($id: ID!) { user(id: $id) { ${USER_FIELDS} } }`,
    { id },
  );
  return data.user;
}

export async function listTenantMembers(
  client: AdminOpsClient,
  tenantId: string,
): Promise<TenantMember[]> {
  const data = await client.graphql<{ tenantMembers: TenantMember[] }>(
    `query($tenantId: ID!) { tenantMembers(tenantId: $tenantId) { ${TENANT_MEMBER_FIELDS} } }`,
    { tenantId },
  );
  return data.tenantMembers ?? [];
}

export async function resendMemberInvite(
  client: AdminOpsClient,
  tenantId: string,
  memberId: string,
): Promise<ResendMemberInviteResult> {
  const data = await client.graphql<{
    resendMemberInvite: ResendMemberInviteResult;
  }>(
    `mutation($tenantId: ID!, $input: ResendMemberInviteInput!) {
      resendMemberInvite(tenantId: $tenantId, input: $input) {
        status
        message
      }
    }`,
    {
      tenantId,
      input: {
        memberId,
        idempotencyKey: `resend-member-invite:${memberId}:${randomUUID()}`,
      },
    },
  );
  return data.resendMemberInvite;
}
