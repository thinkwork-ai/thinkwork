import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  reconcileKestraManagedMcp,
  reconcileTwentyManagedMcp,
} from "../../../lib/managed-mcp-applications.js";
import { requirePlatformOperator } from "./setKnowledgeGraphDeployment.mutation.js";
import {
  normalizeManagedApplicationKey,
  readManagedApplication,
} from "./managedApplications.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";

export const installManagedApplicationMcpServer = async (
  _parent: unknown,
  args: { key?: string },
  ctx: GraphQLContext,
) => {
  await requirePlatformOperator(ctx);

  const key = normalizeManagedApplicationKey(args.key);
  if (key !== "twenty" && key !== "kestra") {
    throw new GraphQLError(
      "This managed application does not support MCP install",
      {
        extensions: { code: "BAD_USER_INPUT" },
      },
    );
  }

  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const application = readManagedApplication(key);
  const result =
    key === "twenty"
      ? await reconcileTwentyManagedMcp({
          tenantId,
          application,
          mode: "running",
        })
      : await reconcileKestraManagedMcp({
          tenantId,
          application,
          mode: "running",
        });

  return {
    key,
    serverId: result.serverId,
    installed: result.installed,
    status: result.status,
    message:
      result.message ?? `${application.displayName} MCP server installed.`,
  };
};
