/**
 * Twin MCP registration step for `thinkwork twin install` (THINK-334 U4).
 *
 * KTD-4: the THINK-333 provisioning route rotates the `tkt_` key on every
 * call by design, so this step is check-then-skip — an existing active
 * `digital-twin` registration is adopted, never re-provisioned, unless the
 * engineer passes --rotate. A 409 `twin_not_deployed` means the product
 * deploy has not carried the Neptune tfvars yet (U3), not a retryable error.
 */

export const TWIN_MCP_SLUG = "digital-twin";

export interface McpServerSummary {
  slug?: string;
  name?: string;
  enabled?: boolean;
  status?: string;
}

export interface TwinMcpClient {
  /** List the tenant's registered MCP servers. */
  listServers: () => Promise<McpServerSummary[]>;
  /**
   * POST the THINK-333 provision route. Returns the parsed body on 2xx
   * (TwinProvisionResult: { provisioned: "created" | "rotated", ... });
   * throws { status, body } shaped errors on non-2xx.
   */
  provision: () => Promise<{ provisioned?: string }>;
}

export interface TwinMcpOutcome {
  state: "found" | "created" | "failed";
  detail: string;
}

export function isActiveTwinRegistration(server: McpServerSummary): boolean {
  const slugMatch = server.slug === TWIN_MCP_SLUG;
  const disabled =
    server.enabled === false ||
    (typeof server.status === "string" &&
      ["disabled", "inactive", "revoked"].includes(
        server.status.toLowerCase(),
      ));
  return slugMatch && !disabled;
}

export async function registerTwinMcp(
  client: TwinMcpClient,
  opts: { rotate: boolean },
): Promise<TwinMcpOutcome> {
  let existing = false;
  try {
    const servers = await client.listServers();
    existing = servers.some(isActiveTwinRegistration);
  } catch (err) {
    return {
      state: "failed",
      detail: `could not list the tenant's MCP servers: ${describeError(err)}`,
    };
  }

  if (existing && !opts.rotate) {
    return {
      state: "found",
      detail:
        "digital-twin MCP registration already active (adopted; pass --rotate to re-key)",
    };
  }

  try {
    const res = await client.provision();
    const verb = res.provisioned ?? "created";
    return {
      state: "created",
      detail: `mcp-twin-provision → ${verb}`,
    };
  } catch (err) {
    const status = errorStatus(err);
    if (status === 409) {
      return {
        state: "failed",
        detail:
          "twin_not_deployed: the product deploy has not carried the Neptune tfvars yet — " +
          "the runtime config lacks NEPTUNE_ENDPOINT. Complete the product wiring step " +
          "(re-run install; it is idempotent) before registering the MCP server.",
      };
    }
    return {
      state: "failed",
      detail: `mcp-twin-provision failed: ${describeError(err)}`,
    };
  }
}

function errorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300);
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err).slice(0, 300);
    } catch {
      /* fall through */
    }
  }
  return String(err).slice(0, 300);
}
