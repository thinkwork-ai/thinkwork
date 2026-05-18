import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EnterpriseAwsBootstrapConfig {
  accountId: string;
  region: string;
  repository: string;
  stages: string[];
  customerSlug: string;
  stateBucket: string;
  lockTable: string;
  artifactBucket: string;
}

export interface EnterpriseAwsStagePlan {
  stage: string;
  roleName: string;
  roleArn: string;
  trustPolicy: GitHubOidcTrustPolicy;
  deployPolicyName: string;
  deployPolicy: IamPolicyDocument;
}

export interface EnterpriseAwsBootstrapPlan {
  stateBucket: string;
  lockTable: string;
  artifactBucket: string;
  oidcProviderArn: string;
  stageRoles: EnterpriseAwsStagePlan[];
}

export interface BootstrapStepResult {
  target: string;
  status: "created" | "reused" | "updated" | "planned";
  message: string;
}

export interface EnterpriseAwsBootstrapClient {
  ensureStateBucket(
    bucket: string,
    region: string,
  ): Promise<BootstrapStepResult>;
  ensureLockTable(table: string, region: string): Promise<BootstrapStepResult>;
  ensureArtifactBucket(
    bucket: string,
    region: string,
  ): Promise<BootstrapStepResult>;
  ensureOidcProvider(accountId: string): Promise<BootstrapStepResult>;
  ensureDeployRole(role: EnterpriseAwsStagePlan): Promise<BootstrapStepResult>;
}

export interface GitHubOidcTrustPolicy {
  Version: "2012-10-17";
  Statement: [
    {
      Effect: "Allow";
      Principal: {
        Federated: string;
      };
      Action: "sts:AssumeRoleWithWebIdentity";
      Condition: {
        StringEquals: Record<string, string>;
      };
    },
  ];
}

export interface IamPolicyDocument {
  Version: "2012-10-17";
  Statement: Array<{
    Sid: string;
    Effect: "Allow";
    Action: string[];
    Resource: string | string[];
  }>;
}

export function buildEnterpriseAwsBootstrapPlan(
  config: EnterpriseAwsBootstrapConfig,
): EnterpriseAwsBootstrapPlan {
  const oidcProviderArn = `arn:aws:iam::${config.accountId}:oidc-provider/token.actions.githubusercontent.com`;
  return {
    stateBucket: config.stateBucket,
    lockTable: config.lockTable,
    artifactBucket: config.artifactBucket,
    oidcProviderArn,
    stageRoles: config.stages.map((stage) => {
      const roleName = `thinkwork-${config.customerSlug}-${stage}-deploy`;
      return {
        stage,
        roleName,
        roleArn: `arn:aws:iam::${config.accountId}:role/${roleName}`,
        trustPolicy: buildGitHubOidcTrustPolicy({
          oidcProviderArn,
          repository: config.repository,
          stage,
        }),
        deployPolicyName: `thinkwork-${config.customerSlug}-${stage}-deploy`,
        deployPolicy: buildEnterpriseDeployRolePolicy({
          accountId: config.accountId,
          region: config.region,
          stage,
          stateBucket: config.stateBucket,
          lockTable: config.lockTable,
          artifactBucket: config.artifactBucket,
        }),
      };
    }),
  };
}

export function buildGitHubOidcTrustPolicy(options: {
  oidcProviderArn: string;
  repository: string;
  stage: string;
}): GitHubOidcTrustPolicy {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Federated: options.oidcProviderArn,
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": `repo:${options.repository}:environment:${options.stage}`,
          },
        },
      },
    ],
  };
}

export function buildEnterpriseDeployRolePolicy(options: {
  accountId: string;
  region: string;
  stage: string;
  stateBucket: string;
  lockTable: string;
  artifactBucket: string;
}): IamPolicyDocument {
  const thinkworkPrefix = `thinkwork-${options.stage}`;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "TerraformStateAndReleaseBuckets",
        Effect: "Allow",
        Action: [
          "s3:GetBucketLocation",
          "s3:GetBucketVersioning",
          "s3:GetEncryptionConfiguration",
          "s3:ListBucket",
          "s3:PutBucketVersioning",
          "s3:PutEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:PutPublicAccessBlock",
        ],
        Resource: [
          `arn:aws:s3:::${options.stateBucket}`,
          `arn:aws:s3:::${options.artifactBucket}`,
          `arn:aws:s3:::${thinkworkPrefix}-*`,
        ],
      },
      {
        Sid: "TerraformStateAndReleaseObjects",
        Effect: "Allow",
        Action: [
          "s3:AbortMultipartUpload",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:PutObject",
        ],
        Resource: [
          `arn:aws:s3:::${options.stateBucket}/*`,
          `arn:aws:s3:::${options.artifactBucket}/*`,
          `arn:aws:s3:::${thinkworkPrefix}-*/*`,
        ],
      },
      {
        Sid: "TerraformStateLocks",
        Effect: "Allow",
        Action: [
          "dynamodb:CreateTable",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:UpdateItem",
        ],
        Resource: `arn:aws:dynamodb:${options.region}:${options.accountId}:table/${options.lockTable}`,
      },
      {
        Sid: "ThinkWorkNamedResources",
        Effect: "Allow",
        Action: [
          "apigateway:*",
          "appsync:*",
          "bedrock:*",
          "bedrock-agentcore:*",
          "cloudfront:*",
          "cognito-idp:*",
          "dynamodb:*",
          "ec2:*",
          "ecr:*",
          "ecs:*",
          "elasticfilesystem:*",
          "elasticloadbalancing:*",
          "events:*",
          "iam:*",
          "lambda:*",
          "logs:*",
          "rds:*",
          "scheduler:*",
          "secretsmanager:*",
          "ses:*",
          "sqs:*",
          "ssm:*",
          "states:*",
          "xray:*",
        ],
        Resource: "*",
      },
    ],
  };
}

export class AwsCliEnterpriseBootstrapClient
  implements EnterpriseAwsBootstrapClient
{
  async ensureStateBucket(
    bucket: string,
    region: string,
  ): Promise<BootstrapStepResult> {
    return ensureBucket(bucket, region, "terraform state bucket");
  }

  async ensureLockTable(
    table: string,
    region: string,
  ): Promise<BootstrapStepResult> {
    if (
      awsOk([
        "dynamodb",
        "describe-table",
        "--table-name",
        table,
        "--region",
        region,
      ])
    ) {
      return {
        target: table,
        status: "reused",
        message: `DynamoDB lock table ${table} already exists.`,
      };
    }

    execFileSync("aws", [
      "dynamodb",
      "create-table",
      "--table-name",
      table,
      "--attribute-definitions",
      "AttributeName=LockID,AttributeType=S",
      "--key-schema",
      "AttributeName=LockID,KeyType=HASH",
      "--billing-mode",
      "PAY_PER_REQUEST",
      "--region",
      region,
    ]);
    return {
      target: table,
      status: "created",
      message: `Created DynamoDB lock table ${table}.`,
    };
  }

  async ensureArtifactBucket(
    bucket: string,
    region: string,
  ): Promise<BootstrapStepResult> {
    return ensureBucket(bucket, region, "release artifact bucket");
  }

  async ensureOidcProvider(accountId: string): Promise<BootstrapStepResult> {
    const arn = `arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com`;
    if (
      awsOk([
        "iam",
        "get-open-id-connect-provider",
        "--open-id-connect-provider-arn",
        arn,
      ])
    ) {
      return {
        target: arn,
        status: "reused",
        message: "GitHub Actions OIDC provider already exists.",
      };
    }

    execFileSync("aws", [
      "iam",
      "create-open-id-connect-provider",
      "--url",
      "https://token.actions.githubusercontent.com",
      "--client-id-list",
      "sts.amazonaws.com",
      "--thumbprint-list",
      "6938fd4d98bab03faadb97b34396831e3780aea1",
    ]);
    return {
      target: arn,
      status: "created",
      message: "Created GitHub Actions OIDC provider.",
    };
  }

  async ensureDeployRole(
    role: EnterpriseAwsStagePlan,
  ): Promise<BootstrapStepResult> {
    if (awsOk(["iam", "get-role", "--role-name", role.roleName])) {
      putRolePolicy(role);
      return {
        target: role.roleArn,
        status: "updated",
        message: `Deploy role ${role.roleName} already exists; updated inline deploy policy ${role.deployPolicyName}.`,
      };
    }

    const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-role-"));
    const trustPath = join(dir, "trust.json");
    writeFileSync(trustPath, JSON.stringify(role.trustPolicy));
    execFileSync("aws", [
      "iam",
      "create-role",
      "--role-name",
      role.roleName,
      "--assume-role-policy-document",
      `file://${trustPath}`,
    ]);
    putRolePolicy(role);

    return {
      target: role.roleArn,
      status: "created",
      message: `Created deploy role ${role.roleName} and attached inline deploy policy ${role.deployPolicyName}.`,
    };
  }
}

function putRolePolicy(role: EnterpriseAwsStagePlan): void {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-policy-"));
  const policyPath = join(dir, "policy.json");
  writeFileSync(policyPath, JSON.stringify(role.deployPolicy));
  execFileSync("aws", [
    "iam",
    "put-role-policy",
    "--role-name",
    role.roleName,
    "--policy-name",
    role.deployPolicyName,
    "--policy-document",
    `file://${policyPath}`,
  ]);
}

function ensureBucket(
  bucket: string,
  region: string,
  label: string,
): BootstrapStepResult {
  if (awsOk(["s3api", "head-bucket", "--bucket", bucket])) {
    return {
      target: bucket,
      status: "reused",
      message: `${label} ${bucket} already exists.`,
    };
  }

  const args =
    region === "us-east-1"
      ? ["s3api", "create-bucket", "--bucket", bucket, "--region", region]
      : [
          "s3api",
          "create-bucket",
          "--bucket",
          bucket,
          "--region",
          region,
          "--create-bucket-configuration",
          `LocationConstraint=${region}`,
        ];
  execFileSync("aws", args);
  execFileSync("aws", [
    "s3api",
    "put-public-access-block",
    "--bucket",
    bucket,
    "--public-access-block-configuration",
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
  ]);
  return {
    target: bucket,
    status: "created",
    message: `Created ${label} ${bucket}.`,
  };
}

function awsOk(args: string[]): boolean {
  try {
    execFileSync("aws", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
