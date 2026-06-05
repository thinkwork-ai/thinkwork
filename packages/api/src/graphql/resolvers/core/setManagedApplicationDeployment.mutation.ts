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
} from "./managedApplications.js";

type DeploymentVariable = {
  name: string;
  value: string;
};

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

  const desiredEnabled = Boolean(args.input?.enabled);
  const config = deploymentControlConfig();
  const token = await readGithubToken(config.tokenSecretId);
  const variables = deploymentVariablesFor(key, desiredEnabled);

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

  const state = deploymentStateFor(key, desiredEnabled);
  return {
    key,
    desiredEnabled,
    provisioned: state.provisioned,
    runtimeEnabled: state.runtimeEnabled,
    workflowUrl: `https://github.com/${config.repository}/actions/workflows/${config.workflowFile}`,
    message: deploymentMessageFor(key, desiredEnabled),
  };
};

function deploymentVariablesFor(
  key: ManagedApplicationKey,
  desiredEnabled: boolean,
): DeploymentVariable[] {
  if (key === "cognee") {
    return [
      {
        name: "COGNEE_ENABLED",
        value: desiredEnabled ? "true" : "false",
      },
    ];
  }

  return [
    { name: "TWENTY_PROVISIONED", value: "true" },
    {
      name: "TWENTY_RUNTIME_ENABLED",
      value: desiredEnabled ? "true" : "false",
    },
  ];
}

function deploymentStateFor(
  key: ManagedApplicationKey,
  desiredEnabled: boolean,
): { provisioned: boolean; runtimeEnabled: boolean } {
  if (key === "cognee") {
    return { provisioned: desiredEnabled, runtimeEnabled: desiredEnabled };
  }
  return { provisioned: true, runtimeEnabled: desiredEnabled };
}

function deploymentMessageFor(
  key: ManagedApplicationKey,
  desiredEnabled: boolean,
): string {
  if (key === "cognee") {
    return `Knowledge Graph ${desiredEnabled ? "enable" : "disable"} deployment queued.`;
  }
  if (desiredEnabled) {
    return "Twenty CRM enable deployment queued.";
  }
  return "Twenty CRM runtime park deployment queued; CRM data and app secrets will be retained.";
}
