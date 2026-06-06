import type { EnterpriseReleasePin } from "./release.js";

export interface EnterpriseAwsDeploymentControlPlanePlan {
  stage: string;
  stateMachineName: string;
  codeBuildProjectName: string;
  evidenceBucket: string;
  ssmPrefix: string;
  appConfigApplicationName: string;
  appConfigEnvironmentName: string;
  appConfigConfigurationProfileName: string;
  secretNames: {
    idpClientSecret: string;
    runnerEnvironment: string;
  };
  profile: EnterpriseDeploymentProfilePlan;
}

export interface EnterpriseDeploymentProfilePlan {
  displayName: string;
  stage: string;
  accountId: string;
  region: string;
  releaseVersion: string;
  apiEndpointParameter: string;
  appUrlParameter: string;
  cognitoUserPoolIdParameter: string;
  cognitoClientIdParameter: string;
}

export function buildEnterpriseAwsDeploymentControlPlanePlan(options: {
  customerSlug: string;
  accountId: string;
  region: string;
  stages: string[];
  release: EnterpriseReleasePin;
}): EnterpriseAwsDeploymentControlPlanePlan[] {
  return options.stages.map((stage) => {
    const prefix = `thinkwork-${stage}-deployment`;
    const ssmPrefix = `/thinkwork/${stage}/deployment`;
    return {
      stage,
      stateMachineName: `${prefix}-orchestrator`,
      codeBuildProjectName: `${prefix}-runner`,
      evidenceBucket: `thinkwork-${stage}-${options.accountId}-deploy-evidence`,
      ssmPrefix,
      appConfigApplicationName: prefix,
      appConfigEnvironmentName: stage,
      appConfigConfigurationProfileName: "deployment-config",
      secretNames: {
        idpClientSecret: `${ssmPrefix}/idp-client-secret`,
        runnerEnvironment: `${ssmPrefix}/runner-secrets`,
      },
      profile: {
        displayName: `${options.customerSlug} ${stage}`,
        stage,
        accountId: options.accountId,
        region: options.region,
        releaseVersion: options.release.version,
        apiEndpointParameter: `${ssmPrefix}/profile/api-endpoint`,
        appUrlParameter: `${ssmPrefix}/profile/app-url`,
        cognitoUserPoolIdParameter: `${ssmPrefix}/profile/cognito-user-pool-id`,
        cognitoClientIdParameter: `${ssmPrefix}/profile/cognito-client-id`,
      },
    };
  });
}
