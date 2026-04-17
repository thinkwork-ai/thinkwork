/**
 * Resolve which tenant (workspace) a command targets.
 *
 * Order:
 *   1. Explicit `--tenant` / `-t` flag (slug).
 *   2. `THINKWORK_TENANT` env var.
 *   3. Cached `tenantSlug` on the stage's session.
 *   4. Interactive picker over the caller's tenant memberships (TTY only).
 *
 * The picker prefers the GraphQL `me.memberships` field — it's identity-aware
 * (only tenants the caller actually belongs to) and works for both auth modes.
 * REST `/api/tenants` stays as a fallback for api-key sessions where we want
 * the full tenant list regardless of membership.
 */

import { select } from "@inquirer/prompts";
import { loadStageSession, saveStageSession } from "../cli-config.js";
import { printError } from "../ui.js";
import { requireTty } from "./interactive.js";

export interface ResolveTenantOptions {
  /** Value of the command's `--tenant` / `-t` flag, if any. */
  flag?: string;
  /** Stage we've already resolved (used to read/write the session cache). */
  stage: string;
  /**
   * Called (lazily) to list the tenants the caller can pick from. Returns
   * `{ id, slug, name }` records. Commands wire this to a GraphQL query over
   * the already-configured client; kept as a callback so this helper stays
   * decoupled from the gql client factory.
   */
  listTenants?: () => Promise<Array<{ id: string; slug: string; name: string }>>;
}

export interface ResolvedTenant {
  slug: string;
  /** Preferred when the server expects ID; may be undefined for legacy callers. */
  id?: string;
}

export async function resolveTenant(opts: ResolveTenantOptions): Promise<ResolvedTenant> {
  // 1. Flag, 2. env — no network required.
  const override = opts.flag ?? process.env.THINKWORK_TENANT;
  if (override) {
    // If the override matches the cached slug we can reuse the cached ID.
    const cached = loadStageSession(opts.stage);
    if (cached && cached.tenantSlug === override) {
      return { slug: override, id: cached.tenantId };
    }
    return { slug: override };
  }

  // 3. Cached on the session.
  const session = loadStageSession(opts.stage);
  if (session?.tenantSlug) {
    return { slug: session.tenantSlug, id: session.tenantId };
  }

  // 4. Picker (only works if the caller supplied `listTenants`).
  if (!opts.listTenants) {
    printError(
      `No tenant resolved for stage "${opts.stage}". Pass --tenant <slug>, set THINKWORK_TENANT, or re-run \`thinkwork login --stage ${opts.stage}\`.`,
    );
    process.exit(1);
  }

  const tenants = await opts.listTenants();
  if (tenants.length === 0) {
    printError(
      "No tenants available. You may need to be invited to a workspace first.",
    );
    process.exit(1);
  }
  if (tenants.length === 1) {
    const only = tenants[0];
    console.log(`  Using the only tenant: ${only.name} (${only.slug})`);
    cacheTenant(opts.stage, only);
    return { slug: only.slug, id: only.id };
  }

  requireTty("Tenant");
  const slug = await select({
    message: "Which tenant?",
    choices: tenants.map((t) => ({
      name: `${t.name}  (slug: ${t.slug})`,
      value: t.slug,
    })),
    loop: false,
  });
  const picked = tenants.find((t) => t.slug === slug)!;
  cacheTenant(opts.stage, picked);
  return { slug: picked.slug, id: picked.id };
}

function cacheTenant(
  stage: string,
  tenant: { id: string; slug: string },
): void {
  const session = loadStageSession(stage);
  if (!session) return;
  saveStageSession(stage, { ...session, tenantId: tenant.id, tenantSlug: tenant.slug });
}
