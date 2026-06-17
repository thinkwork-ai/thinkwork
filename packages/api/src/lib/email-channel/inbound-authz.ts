import { and, eq, sql } from "drizzle-orm";
import {
  emailSpacePolicies,
  emailSpaceSenderAllowlists,
  spaceMembers,
  users,
} from "@thinkwork/database-pg/schema";
import type { InboundSpaceRoute } from "./inbound-routing.js";
import { normalizeEmail } from "./inbound-routing.js";

export type InboundAuthorization =
  | {
      authorized: true;
      actor: "registered_user" | "allowlisted_external";
      senderUserId: string | null;
      reasonCode: string;
    }
  | {
      authorized: false;
      reasonCode:
        | "space_archived"
        | "space_policy_missing"
        | "space_policy_disabled"
        | "registered_users_disabled"
        | "private_space_membership_required"
        | "outside_sender_denied"
        | "outside_sender_not_allowlisted";
    };

export async function authorizeInboundSpaceSender(input: {
  db: {
    select: (fields?: unknown) => any;
  };
  route: InboundSpaceRoute;
  senderEmail: string;
}): Promise<InboundAuthorization> {
  const senderEmail = normalizeEmail(input.senderEmail);
  if (input.route.spaceStatus === "archived") {
    return { authorized: false, reasonCode: "space_archived" };
  }

  const [policy] = await input.db
    .select({
      enabled: emailSpacePolicies.enabled,
      registeredUsersAllowed: emailSpacePolicies.registered_users_allowed,
      privateSpaceMembershipRequired:
        emailSpacePolicies.private_space_membership_required,
      outsideSenderDefault: emailSpacePolicies.outside_sender_default,
    })
    .from(emailSpacePolicies)
    .where(
      and(
        eq(emailSpacePolicies.tenant_id, input.route.tenantId),
        eq(emailSpacePolicies.space_id, input.route.spaceId),
      ),
    )
    .limit(1);

  if (!policy) return { authorized: false, reasonCode: "space_policy_missing" };
  if (!policy.enabled) {
    return { authorized: false, reasonCode: "space_policy_disabled" };
  }

  const [sender] = await input.db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant_id, input.route.tenantId),
        sql`lower(${users.email}) = ${senderEmail}`,
      ),
    )
    .limit(1);

  if (sender) {
    if (!policy.registeredUsersAllowed) {
      return {
        authorized: false,
        reasonCode: "registered_users_disabled",
      };
    }
    if (
      input.route.spaceAccessMode === "private" &&
      policy.privateSpaceMembershipRequired
    ) {
      const [member] = await input.db
        .select({ id: spaceMembers.id })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.tenant_id, input.route.tenantId),
            eq(spaceMembers.space_id, input.route.spaceId),
            eq(spaceMembers.user_id, sender.id),
          ),
        )
        .limit(1);
      if (!member) {
        return {
          authorized: false,
          reasonCode: "private_space_membership_required",
        };
      }
    }

    return {
      authorized: true,
      actor: "registered_user",
      senderUserId: sender.id,
      reasonCode: "registered_user_allowed",
    };
  }

  if (policy.outsideSenderDefault !== "allowlist") {
    return { authorized: false, reasonCode: "outside_sender_denied" };
  }

  if (
    !(await senderMatchesAllowlist({
      db: input.db,
      tenantId: input.route.tenantId,
      spaceId: input.route.spaceId,
      senderEmail,
    }))
  ) {
    return {
      authorized: false,
      reasonCode: "outside_sender_not_allowlisted",
    };
  }

  return {
    authorized: true,
    actor: "allowlisted_external",
    senderUserId: null,
    reasonCode: "outside_sender_allowlisted",
  };
}

async function senderMatchesAllowlist(input: {
  db: { select: (fields?: unknown) => any };
  tenantId: string;
  spaceId: string;
  senderEmail: string;
}): Promise<boolean> {
  const domain = input.senderEmail.split("@")[1] ?? "";
  const rows = await input.db
    .select({ id: emailSpaceSenderAllowlists.id })
    .from(emailSpaceSenderAllowlists)
    .where(
      and(
        eq(emailSpaceSenderAllowlists.tenant_id, input.tenantId),
        eq(emailSpaceSenderAllowlists.space_id, input.spaceId),
        sql`(
          (${emailSpaceSenderAllowlists.value_type} = 'email' AND lower(${emailSpaceSenderAllowlists.value}) = ${input.senderEmail})
          OR (${emailSpaceSenderAllowlists.value_type} = 'domain' AND lower(${emailSpaceSenderAllowlists.value}) = ${domain})
        )`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
