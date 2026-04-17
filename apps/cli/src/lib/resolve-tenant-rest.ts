/**
 * REST-backed tenant resolver for commands that talk to `/api/tenants` via
 * `api-client.apiFetch` (mcp, tools, user). Wraps the shared `resolveTenant`
 * helper with an apiFetch-based `listTenants` callback so every REST command
 * gets the same flag > env > session > picker fallback as GraphQL commands.
 *
 * Pairs with `lib/resolve-stage.ts` — commands should call both at the top of
 * their action to replace the old `.requiredOption('-s, --stage')` +
 * `.requiredOption('--tenant')` pattern with interactive fallback when any is
 * missing.
 */

import { apiFetch } from "../api-client.js";
import { resolveTenant, type ResolvedTenant } from "./resolve-tenant.js";

export interface ResolveTenantRestOptions {
  /** Value of the command's `--tenant` / `-t` flag, if any. */
  flag?: string;
  /** Stage we've already resolved — same one passed to `resolveStage()`. */
  stage: string;
  /** API gateway base URL (from `resolveApiConfig(stage)`). */
  apiUrl: string;
  /** Bearer secret (from `resolveApiConfig(stage)`). */
  authSecret: string;
}

export async function resolveTenantRest(
  opts: ResolveTenantRestOptions,
): Promise<ResolvedTenant> {
  return resolveTenant({
    flag: opts.flag,
    stage: opts.stage,
    listTenants: async () => {
      const list = (await apiFetch(
        opts.apiUrl,
        opts.authSecret,
        "/api/tenants",
      )) as Array<{ id: string; slug: string; name: string }>;
      return list;
    },
  });
}
