#!/usr/bin/env tsx
/**
 * Seed user_brain_claims for a tenant's active members (THINK-625, rollout
 * step 3).
 *
 * The Brain's legacy authorization is a Cognito-group → grants mapping that
 * lives in the company-brain deployment (`MCP_OAUTH_GROUP_GRANTS`), NOT in
 * this repo — so this script cannot read it, and guessing would silently
 * change what people can see. It takes the mapping as an explicit JSON file
 * instead: whoever runs the backfill is stating, on the record, what the
 * current grants are.
 *
 * Dry-run by default. Nothing is written and nothing is published until
 * `--write` is passed.
 *
 * Usage:
 *   tsx scripts/backfill-user-claims.ts \
 *     --tenant <tenant-uuid-or-slug> \
 *     --mapping ./brain-group-grants.json \
 *     [--write] [--overwrite]
 *
 * Mapping file shape:
 *
 * {
 *   // Grants applied to a member who matches no group and has no override.
 *   // Omit to skip such members entirely rather than granting them anything.
 *   "default": {
 *     "securityGroups": [], "kbCollections": [], "kbBundles": {},
 *     "defaultKbBundle": null, "toolAllowlist": null, "operator": false,
 *     "kbTrace": false
 *   },
 *   // The Brain's group → grants table, copied from MCP_OAUTH_GROUP_GRANTS.
 *   "groups": {
 *     "FINANCE": { "securityGroups": ["FINANCE"], "kbCollections": ["handbook"] }
 *   },
 *   // Which groups each member is in, keyed by lowercased email. Supply this
 *   // from your identity provider (e.g. `aws cognito-idp admin-list-groups-
 *   // for-user`) — this script does not call Cognito, so that the mapping it
 *   // acted on is reviewable in one file.
 *   "userGroups": { "person@customer.com": ["FINANCE"] },
 *   // Per-user last word; merged over whatever the groups produced.
 *   "users": { "operator@customer.com": { "operator": true } }
 * }
 *
 * Union semantics: a member in several groups gets the union of their
 * `securityGroups` / `kbCollections` / `kbBundles`; `operator` and `kbTrace`
 * are OR'd; `defaultKbBundle` and `toolAllowlist` take the first non-null in
 * group order. `"*"` anywhere wins for that dimension.
 *
 * Members with no `users.cognito_sub` are reported loudly: the Brain's OAuth
 * lane matches on `subject` first and lowercased email second, so an unmatched
 * identity reads as "no entry" and fails closed. Backfill those before
 * enabling the tenant flag.
 */

import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  tenantMembers,
  tenants,
  userBrainClaims,
  users,
} from "@thinkwork/database-pg/schema";

interface GrantSpec {
  securityGroups?: string[];
  kbCollections?: string[];
  kbBundles?: Record<string, string[]>;
  defaultKbBundle?: string | null;
  toolAllowlist?: string[] | null;
  operator?: boolean;
  kbTrace?: boolean;
}

interface MappingFile {
  default?: GrantSpec;
  groups?: Record<string, GrantSpec>;
  userGroups?: Record<string, string[]>;
  users?: Record<string, GrantSpec>;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const argv = process.argv.slice(2);
  const inline = argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith("--")) {
    return argv[index + 1];
  }
  return undefined;
}

const flags = new Set(process.argv.slice(2));
const write = flags.has("--write");
const overwrite = flags.has("--overwrite");
const tenantRef = arg("tenant");
const mappingPath = arg("mapping");

if (!tenantRef || !mappingPath) {
  console.error(
    "usage: tsx scripts/backfill-user-claims.ts --tenant <uuid-or-slug> --mapping <file.json> [--write] [--overwrite]",
  );
  process.exit(1);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Union two grant specs, later winning only where it is decisive. */
export function mergeGrants(base: GrantSpec, next: GrantSpec): GrantSpec {
  const union = (a?: string[], b?: string[]) => {
    const out = [...(a ?? [])];
    for (const value of b ?? []) if (!out.includes(value)) out.push(value);
    return out.includes("*") ? ["*"] : out;
  };
  const bundles = { ...(base.kbBundles ?? {}) };
  for (const [name, collections] of Object.entries(next.kbBundles ?? {})) {
    bundles[name] = union(bundles[name], collections);
  }
  return {
    securityGroups: union(base.securityGroups, next.securityGroups),
    kbCollections: union(base.kbCollections, next.kbCollections),
    kbBundles: bundles,
    defaultKbBundle: next.defaultKbBundle ?? base.defaultKbBundle ?? null,
    toolAllowlist:
      next.toolAllowlist !== undefined
        ? next.toolAllowlist
        : (base.toolAllowlist ?? null),
    operator: Boolean(base.operator) || Boolean(next.operator),
    kbTrace: Boolean(base.kbTrace) || Boolean(next.kbTrace),
  };
}

/** Resolve one member's grants, or null when the mapping covers them nowhere. */
export function resolveGrantsForEmail(
  mapping: MappingFile,
  email: string | null,
): GrantSpec | null {
  const key = email?.toLowerCase() ?? null;
  const groupNames = (key && mapping.userGroups?.[key]) || [];
  const override = key ? mapping.users?.[key] : undefined;

  if (groupNames.length === 0 && !override && !mapping.default) return null;

  let grants: GrantSpec = mapping.default ? { ...mapping.default } : {};
  for (const name of groupNames) {
    const spec = mapping.groups?.[name];
    if (!spec) {
      console.warn(`  ! group "${name}" is not defined in the mapping file`);
      continue;
    }
    grants = mergeGrants(grants, spec);
  }
  if (override) grants = mergeGrants(grants, override);
  return grants;
}

async function main() {
  const mapping = JSON.parse(readFileSync(mappingPath!, "utf8")) as MappingFile;
  const db = getDb();

  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(
      UUID_RE.test(tenantRef!)
        ? eq(tenants.id, tenantRef!)
        : eq(tenants.slug, tenantRef!),
    );
  if (!tenant) {
    console.error(`tenant not found: ${tenantRef}`);
    process.exit(1);
  }

  const members = await db
    .select({
      userId: users.id,
      email: users.email,
      cognitoSub: users.cognito_sub,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.principal_id))
    .where(
      and(
        eq(tenantMembers.tenant_id, tenant.id),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.status, "active"),
      ),
    );

  const counters = {
    members: members.length,
    seeded: 0,
    skippedExisting: 0,
    skippedUnmapped: 0,
    missingCognitoSub: [] as string[],
  };

  for (const member of members) {
    const label = member.email ?? member.userId;
    if (!member.cognitoSub) counters.missingCognitoSub.push(label);

    const grants = resolveGrantsForEmail(mapping, member.email);
    if (!grants) {
      counters.skippedUnmapped += 1;
      console.log(`  - ${label}: no mapping entry, skipped`);
      continue;
    }

    const [existing] = await db
      .select({ id: userBrainClaims.id })
      .from(userBrainClaims)
      .where(
        and(
          eq(userBrainClaims.tenant_id, tenant.id),
          eq(userBrainClaims.user_id, member.userId),
        ),
      );
    if (existing && !overwrite) {
      counters.skippedExisting += 1;
      console.log(`  = ${label}: claims already exist, skipped`);
      continue;
    }

    const values = {
      security_groups: grants.securityGroups ?? [],
      kb_collections: grants.kbCollections ?? [],
      kb_bundles: grants.kbBundles ?? {},
      default_kb_bundle: grants.defaultKbBundle ?? null,
      tool_allowlist: grants.toolAllowlist ?? null,
      is_operator: Boolean(grants.operator),
      kb_trace: Boolean(grants.kbTrace),
      enabled: true,
      notes: "seeded by scripts/backfill-user-claims.ts",
    };

    console.log(`  + ${label}: ${JSON.stringify(values)}`);
    if (write) {
      if (existing) {
        await db
          .update(userBrainClaims)
          .set({ ...values, updated_at: new Date() })
          .where(eq(userBrainClaims.id, existing.id));
      } else {
        await db.insert(userBrainClaims).values({
          tenant_id: tenant.id,
          user_id: member.userId,
          ...values,
        });
      }
    }
    counters.seeded += 1;
  }

  console.log(
    JSON.stringify(
      { mode: write ? "write" : "dry-run", tenant: tenant.slug, ...counters },
      null,
      2,
    ),
  );

  if (counters.missingCognitoSub.length > 0) {
    console.warn(
      `\nWARNING: ${counters.missingCognitoSub.length} member(s) have no users.cognito_sub.\n` +
        "The Brain matches on subject first and lowercased email second — members\n" +
        "with neither will read as 'no entry' and fail closed. Backfill cognito_sub\n" +
        "before flipping tenant_settings.brain_user_claims_enabled on.",
    );
  }
  if (!write) {
    console.log("\nDry run — re-run with --write to persist.");
  } else {
    console.log(
      "\nClaims written. Publish by flipping brain_user_claims_enabled on, or\n" +
        "calling the republishUserClaimsManifest mutation if it is already on.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
