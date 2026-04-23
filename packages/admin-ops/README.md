# @thinkwork/admin-ops

Typed client functions for Thinkwork admin operations. Shared by:

- `apps/cli` — the `thinkwork` CLI's admin subcommands (`tenant`, `team`, `agent`, etc.).
- `apps/admin-ops-mcp` — the MCP server that exposes admin operations as tools for agents.

Both consumers import the same typed function surface, so a new operation lands in one place and flows to both callers.

## Usage

```ts
import { createClient, tenants } from "@thinkwork/admin-ops";

const client = createClient({
  apiUrl: "https://api.dev.thinkwork.ai",
  authSecret: process.env.THINKWORK_API_SECRET!,
  principalId: "user-uuid",      // optional; identifies the acting human
  principalEmail: "eric@...",    // optional; fallback for federated sign-in
  tenantId: "tenant-uuid",       // optional; passed as x-tenant-id header
});

const allTenants = await tenants.listTenants(client);
const one = await tenants.getTenant(client, "tenant-uuid");
```

## Auth

v1 reuses the existing `THINKWORK_API_SECRET` bearer token with `x-principal-id`/`x-tenant-id` headers — the same auth path today's REST handlers accept via `validateApiSecret`. Callers:

- **CLI:** reads the secret from the stage's Secrets Manager entry via `resolveApiConfig`.
- **MCP server:** reads the secret from `THINKWORK_API_SECRET` env on the Lambda.

A Cognito-bearer variant is out of scope for v1 — when/if we migrate agents to user-bound JWTs, the client's `authSecret` slot accepts any Bearer token.

## Errors

All functions throw `AdminOpsError` on non-2xx responses:

```ts
import { AdminOpsError } from "@thinkwork/admin-ops";

try {
  await tenants.getTenant(client, "missing");
} catch (err) {
  if (err instanceof AdminOpsError && err.status === 404) {
    // handle not-found
  }
}
```

## Adding a new operation

1. Add the typed function to an existing module (e.g. `src/tenants.ts`) or create a new one (`src/teams.ts`).
2. Re-export it from `src/index.ts`.
3. Register the corresponding MCP tool in `apps/admin-ops-mcp/src/tools/`.
4. Wire the CLI subcommand to call it in `apps/cli/src/commands/`.

That's the whole contract.
