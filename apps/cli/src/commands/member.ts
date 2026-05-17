/**
 * `thinkwork member ...` — tenant membership management (users + agents as
 * members). The existing `thinkwork user invite` stays as a convenience
 * wrapper for the common flow.
 *
 * Implementations inline (4 subcommands).
 */

import { Command } from "commander";
import { confirm, input } from "@inquirer/prompts";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const TenantMembersDoc = graphql(`
  query CliTenantMembers($tenantId: ID!) {
    tenantMembers(tenantId: $tenantId) {
      id
      tenantId
      principalType
      principalId
      role
      status
      createdAt
    }
  }
`);

const InviteMemberDoc = graphql(`
  mutation CliInviteMember($tenantId: ID!, $input: InviteMemberInput!) {
    inviteMember(tenantId: $tenantId, input: $input) {
      id
      principalId
      role
      status
    }
  }
`);

const UpdateTenantMemberDoc = graphql(`
  mutation CliUpdateTenantMember($id: ID!, $input: UpdateTenantMemberInput!) {
    updateTenantMember(id: $id, input: $input) {
      id
      role
      status
    }
  }
`);

const RemoveTenantMemberDoc = graphql(`
  mutation CliRemoveTenantMember($id: ID!) {
    removeTenantMember(id: $id)
  }
`);

const MemberTenantBySlugDoc = graphql(`
  query CliMemberTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
      name
    }
  }
`);

interface MemberCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

interface ListOptions extends MemberCliOptions {
  principalType?: string;
  role?: string;
}

interface InviteOptions extends MemberCliOptions {
  role?: string;
  name?: string;
}

interface UpdateOptions extends MemberCliOptions {
  role?: string;
  status?: string;
}

interface RemoveOptions extends MemberCliOptions {
  yes?: boolean;
}

async function resolveMemberContext(opts: MemberCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxTenantSlug } = await getGqlClient({ stage, region });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;

  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { stage, region, client, tenantId: session.tenantId, tenantSlug: flagOrEnv };
    }
    const data = await gqlQuery(client, MemberTenantBySlugDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return {
      stage,
      region,
      client,
      tenantId: data.tenantBySlug.id,
      tenantSlug: data.tenantBySlug.slug,
    };
  }

  if (session?.tenantId && session.tenantSlug) {
    return { stage, region, client, tenantId: session.tenantId, tenantSlug: session.tenantSlug };
  }

  if (ctxTenantSlug) {
    const data = await gqlQuery(client, MemberTenantBySlugDoc, { slug: ctxTenantSlug });
    if (data.tenantBySlug) {
      return {
        stage,
        region,
        client,
        tenantId: data.tenantBySlug.id,
        tenantSlug: data.tenantBySlug.slug,
      };
    }
  }

  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

async function runMemberList(opts: ListOptions): Promise<void> {
  const ctx = await resolveMemberContext(opts);
  const data = await gqlQuery(ctx.client, TenantMembersDoc, { tenantId: ctx.tenantId });
  let items = data.tenantMembers ?? [];

  if (opts.principalType) {
    const want = opts.principalType.toUpperCase();
    items = items.filter((m) => (m.principalType ?? "").toUpperCase() === want);
  }
  if (opts.role) {
    items = items.filter((m) => m.role === opts.role);
  }

  if (isJsonMode()) {
    printJson({ items });
    return;
  }

  const rows = items.map((m) => ({
    id: m.id,
    type: m.principalType ?? "—",
    principal: m.principalId.length > 36 ? `${m.principalId.slice(0, 33)}…` : m.principalId,
    role: m.role,
    status: m.status,
  }));

  printTable(rows, [
    { key: "id", header: "MEMBER ID" },
    { key: "type", header: "TYPE" },
    { key: "principal", header: "PRINCIPAL" },
    { key: "role", header: "ROLE" },
    { key: "status", header: "STATUS" },
  ]);
}

async function runMemberInvite(
  email: string | undefined,
  opts: InviteOptions,
): Promise<void> {
  const ctx = await resolveMemberContext(opts);
  const interactive = isInteractive();

  let resolvedEmail = email;
  if (!resolvedEmail) {
    if (!interactive) {
      printError("Email is required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Invitee email");
    resolvedEmail = await promptOrExit(() => input({ message: "Invitee email:" }));
  }

  const data = await gqlMutate(ctx.client, InviteMemberDoc, {
    tenantId: ctx.tenantId,
    input: {
      email: resolvedEmail!,
      role: opts.role ?? "member",
      name: opts.name ?? null,
    },
  });
  const member = data.inviteMember;

  if (isJsonMode()) {
    printJson(member);
    return;
  }
  printSuccess(`Invited ${resolvedEmail} as ${member.role} (member id ${member.id}).`);
}

async function runMemberUpdate(memberId: string, opts: UpdateOptions): Promise<void> {
  const ctx = await resolveMemberContext(opts);

  const input: Record<string, unknown> = {};
  if (opts.role !== undefined) input.role = opts.role;
  if (opts.status !== undefined) input.status = opts.status;

  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --role, --status.");
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, UpdateTenantMemberDoc, { id: memberId, input });
  const updated = data.updateTenantMember;

  if (isJsonMode()) {
    printJson(updated);
    return;
  }
  printSuccess(`Updated member ${updated.id} (role=${updated.role}, status=${updated.status}).`);
}

async function runMemberRemove(memberId: string, opts: RemoveOptions): Promise<void> {
  const ctx = await resolveMemberContext(opts);

  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to remove without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Remove member ${memberId}? (Cognito user is NOT deleted.)`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }

  const data = await gqlMutate(ctx.client, RemoveTenantMemberDoc, { id: memberId });

  if (isJsonMode()) {
    printJson({ id: memberId, removed: data.removeTenantMember });
    return;
  }
  if (data.removeTenantMember) printSuccess(`Removed member ${memberId}.`);
  else printError(`Server reported not-removed for ${memberId}.`);
}

export function registerMemberCommand(program: Command): void {
  const mem = program
    .command("member")
    .alias("members")
    .description("List and manage tenant members (users + agents with access).");

  mem
    .command("list")
    .alias("ls")
    .description("List every member of the current tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--principal-type <t>", "Filter: USER | AGENT")
    .option("--role <r>", "Filter by role (member, admin, owner)")
    .action(runMemberList);

  mem
    .command("invite [email]")
    .description("Invite a user by email. GraphQL path (sends invite email, creates Cognito user).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--role <role>", "member | admin | owner", "member")
    .option("--name <n>", "Optional display name")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork member invite alice@example.com --role admin
  $ thinkwork member invite                                  # interactive
`,
    )
    .action(runMemberInvite);

  mem
    .command("update <memberId>")
    .description("Change a member's role or status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--role <r>")
    .option("--status <s>", "active | suspended")
    .action(runMemberUpdate);

  mem
    .command("remove <memberId>")
    .description("Remove a member from the tenant. The underlying Cognito user is NOT deleted.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runMemberRemove);
}
