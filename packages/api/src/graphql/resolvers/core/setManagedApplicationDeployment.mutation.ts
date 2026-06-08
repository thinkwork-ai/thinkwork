import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  deploymentControlConfig,
  dispatchDeployWorkflow,
  readGithubToken,
  requirePlatformOperator,
  upsertGithubActionsVariable,
} from "./setKnowledgeGraphDeployment.mutation.js";
import {
  type ManagedApplicationKey,
  normalizeManagedApplicationKey,
  readManagedApplication,
} from "./managedApplications.js";
import { resolveCallerTenantId } from "./resolve-auth-user.js";
import { reconcileTwentyManagedMcp } from "../../../lib/managed-mcp-applications.js";

type DeploymentVariable = {
  name: string;
  value: string;
};

type DeploymentAction = "ENABLE" | "PARK" | "DESTROY";

export const setManagedApplicationDeployment = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  await requirePlatformOperator(ctx);

  const key = normalizeManagedApplicationKey(args.input?.key);
  if (!key) {
    throw new GraphQLError("Unknown managed application key", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const action = resolveDeploymentAction(key, args.input);
  const config = deploymentControlConfig();
  const token = await readGithubToken(config.tokenSecretId);
  const variables = deploymentVariablesFor(key, action);

  for (const variable of variables) {
    await upsertGithubActionsVariable({
      token,
      repository: config.repository,
      name: variable.name,
      value: variable.value,
    });
  }

  await dispatchDeployWorkflow({
    token,
    repository: config.repository,
    workflowFile: config.workflowFile,
    ref: config.ref,
  });

  await reconcileManagedMcpAfterDeploymentRequest(ctx, key, action);

  const state = deploymentStateFor(key, action);
  return {
    key,
    action,
    desiredEnabled: state.runtimeEnabled,
    provisioned: state.provisioned,
    runtimeEnabled: state.runtimeEnabled,
    workflowUrl: `https://github.com/${config.repository}/actions/workflows/${config.workflowFile}`,
    message: deploymentMessageFor(key, action),
  };
};

function resolveDeploymentAction(
  key: ManagedApplicationKey,
  input: any,
): DeploymentAction {
  const rawAction =
    typeof input?.action === "string" ? input.action.toUpperCase() : null;
  const action =
    rawAction === "ENABLE" || rawAction === "PARK" || rawAction === "DESTROY"
      ? rawAction
      : null;

  if (action) {
    if (key === "cognee" && action === "PARK") {
      throw new GraphQLError("Cognee does not support parked runtime state", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    return action;
  }

  if (typeof input?.enabled === "boolean") {
    if (input.enabled) return "ENABLE";
    return key === "cognee" ? "DESTROY" : "PARK";
  }

  throw new GraphQLError("Managed application action is required", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

async function reconcileManagedMcpAfterDeploymentRequest(
  ctx: GraphQLContext,
  key: ManagedApplicationKey,
  action: DeploymentAction,
) {
  if (key !== "twenty") return;

  const tenantId = await resolveCallerTenantId(ctx);
  if (!tenantId) return;

  try {
    const application = readManagedApplication("twenty");
    if (action === "PARK") {
      await reconcileTwentyManagedMcp({
        tenantId,
        application,
        mode: "parked",
      });
      return;
    }
    if (action === "DESTROY") {
      await reconcileTwentyManagedMcp({
        tenantId,
        application,
        mode: "destroyed",
      });
      return;
    }
    if (application.runtimeEnabled && application.url) {
      await reconcileTwentyManagedMcp({
        tenantId,
        application,
        mode: "running",
      });
    }
  } catch (error) {
    console.warn(
      "[managed-app-deployment] Twenty MCP reconciliation skipped:",
      (error as Error).message,
    );
  }
}

function deploymentVariablesFor(
  key: ManagedApplicationKey,
  action: DeploymentAction,
): DeploymentVariable[] {
  if (key === "cognee") {
    return [
      {
        name: "COGNEE_ENABLED",
        value: action === "ENABLE" ? "true" : "false",
      },
    ];
  }

  const enable = action === "ENABLE";
  const park = action === "PARK";
  if (key === "kestra") {
    return [
      { name: "KESTRA_PROVISIONED", value: enable || park ? "true" : "false" },
      {
        name: "KESTRA_RUNTIME_ENABLED",
        value: enable ? "true" : "false",
      },
      {
        name: "KESTRA_DESTROY_DATA",
        value: action === "DESTROY" ? "true" : "false",
      },
    ];
  }

  return [
    { name: "TWENTY_PROVISIONED", value: enable || park ? "true" : "false" },
    {
      name: "TWENTY_RUNTIME_ENABLED",
      value: enable ? "true" : "false",
    },
    {
      name: "TWENTY_DESTROY_DATA",
      value: action === "DESTROY" ? "true" : "false",
    },
  ];
}

function deploymentStateFor(
  key: ManagedApplicationKey,
  action: DeploymentAction,
): { provisioned: boolean; runtimeEnabled: boolean } {
  if (key === "cognee") {
    const enabled = action === "ENABLE";
    return { provisioned: enabled, runtimeEnabled: enabled };
  }
  return {
    provisioned: action === "ENABLE" || action === "PARK",
    runtimeEnabled: action === "ENABLE",
  };
}

function deploymentMessageFor(
  key: ManagedApplicationKey,
  action: DeploymentAction,
): string {
  if (key === "cognee") {
    return `Knowledge Graph ${action === "ENABLE" ? "enable" : "disable"} deployment queued.`;
  }
  if (key === "kestra") {
    if (action === "ENABLE") {
      return "Kestra enable deployment queued.";
    }
    if (action === "DESTROY") {
      return "Kestra destructive cleanup queued; runtime, internal storage, app secrets, and the dedicated database will be removed.";
    }
    return "Kestra runtime park deployment queued; flow definitions, execution history, storage, and credentials will be retained.";
  }
  if (action === "ENABLE") {
    return "Twenty CRM enable deployment queued.";
  }
  if (action === "DESTROY") {
    return "Twenty CRM destructive cleanup queued; runtime, storage, cache, secrets, and the dedicated database will be removed.";
  }
  return "Twenty CRM runtime park deployment queued; CRM data and app secrets will be retained.";
}
