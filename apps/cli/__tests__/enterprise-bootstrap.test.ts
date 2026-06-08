import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildEnterpriseBootstrapPlan,
  runEnterpriseBootstrap,
} from "../src/commands/enterprise/bootstrap.js";
import {
  buildEnterpriseDeployRolePolicy,
  buildGitHubOidcTrustPolicy,
} from "../src/commands/enterprise/aws-bootstrap.js";
import { resolveEnterpriseReleasePin } from "../src/commands/enterprise/release.js";
import { VERSION } from "../src/version.js";
import type {
  BootstrapStepResult,
  EnterpriseAwsBootstrapClient,
  EnterpriseAwsStagePlan,
} from "../src/commands/enterprise/aws-bootstrap.js";
import type {
  EnterpriseAwsDeploymentControlPlaneClient,
  EnterpriseAwsDeploymentControlPlanePlan,
} from "../src/commands/enterprise/aws-deployments.js";
import type {
  EnterpriseGitHubBootstrapClient,
  GitHubEnvironmentPlan,
} from "../src/commands/enterprise/github.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "thinkwork-enterprise-bootstrap-"));
  tempDirs.push(dir);
  return dir;
}

const identity = {
  account: "111122223333",
  region: "us-west-2",
  arn: "arn:aws:sts::111122223333:assumed-role/Admin/session",
};
const manifestSha256 =
  "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("enterprise bootstrap plan", () => {
  it("defaults the release pin to the running CLI version", () => {
    const release = resolveEnterpriseReleasePin({});

    expect(release.version).toBe(`v${VERSION}`);
    expect(release.terraformModuleVersion).toBe(VERSION);
    expect(release.manifestSha256).toBeUndefined();
  });

  it("plans AWS, GitHub, repo files, environments, and workflow dispatch in dry-run mode", async () => {
    const root = tempRepo();
    const saveDeployment = vi.fn();
    const result = await runEnterpriseBootstrap(
      {
        targetDir: root,
        customerSlug: "acme",
        repository: "acme/thinkwork-deploy",
        stages: ["dev", "prod"],
        releaseVersion: "v1.2.3",
        dryRun: true,
        dispatchWorkflow: true,
      },
      { identity, saveDeployment },
    );

    expect(result.plan.aws.stateBucket).toBe("acme-thinkwork-terraform-state");
    expect(result.plan.aws.artifactBucket).toBe(
      "acme-thinkwork-release-artifacts",
    );
    expect(result.aws.every((step) => step.status === "planned")).toBe(true);
    expect(result.aws.map((step) => step.target)).toEqual(
      expect.arrayContaining([
        "acme-thinkwork-terraform-state",
        "acme-thinkwork-terraform-locks",
        "acme-thinkwork-release-artifacts",
        "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com",
        "arn:aws:iam::111122223333:role/thinkwork-acme-dev-deploy",
        "arn:aws:iam::111122223333:role/thinkwork-acme-prod-deploy",
      ]),
    );
    expect(result.github.some((step) => step.target.includes("prod"))).toBe(
      true,
    );
    expect(result.github.map((step) => step.target)).toContain(
      "acme/thinkwork-deploy:deploy.yml:prod",
    );
    expect(result.github.map((step) => step.target)).toContain(
      "acme/thinkwork-deploy:prod:secrets",
    );
    expect(readFileSync(join(root, "thinkwork.lock"), "utf8")).toContain(
      "v1.2.3",
    );
    expect(
      readFileSync(join(root, "customer/deployment.json"), "utf8"),
    ).toContain("acme");
    expect(result.metadata.status).toBe("planned");
    expect(saveDeployment).not.toHaveBeenCalled();
  });

  it("plans identity provider setup without storing bootstrap secrets", async () => {
    const saveDeployment = vi.fn();
    const result = await runEnterpriseBootstrap(
      {
        targetDir: tempRepo(),
        customerSlug: "acme",
        stages: ["dev"],
        identityProvider: {
          type: "oidc",
          providerName: "AcmeOIDC",
          clientId: "client",
          clientSecret: "super-secret",
          issuerUrl: "https://login.example.com",
        },
        dryRun: true,
      },
      { identity, saveDeployment },
    );

    expect(result.plan.identityProvider).toEqual(
      expect.objectContaining({
        type: "oidc",
        providerName: "AcmeOIDC",
        secretRequired: true,
      }),
    );
    expect(result.aws.map((step) => step.target)).toContain(
      "acme:identity-provider:AcmeOIDC",
    );
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(saveDeployment).not.toHaveBeenCalled();
  });

  it("reuses existing mocked resources on repeated non-dry-run bootstrap", async () => {
    const root = tempRepo();
    const awsClient = new ExistingAwsClient();
    const deploymentControlPlaneClient =
      new ExistingDeploymentControlPlaneClient();
    const githubClient = new ExistingGitHubClient();

    const first = await runEnterpriseBootstrap(
      {
        targetDir: root,
        customerSlug: "acme",
        repository: "acme/thinkwork-deploy",
        stages: ["dev"],
        manifestSha256,
        dryRun: false,
      },
      {
        identity,
        awsClient,
        deploymentControlPlaneClient,
        githubClient,
        saveDeployment: vi.fn(),
      },
    );
    const second = await runEnterpriseBootstrap(
      {
        targetDir: root,
        customerSlug: "acme",
        repository: "acme/thinkwork-deploy",
        stages: ["dev"],
        manifestSha256,
        dryRun: false,
      },
      {
        identity,
        awsClient,
        deploymentControlPlaneClient,
        githubClient,
        saveDeployment: vi.fn(),
      },
    );

    expect(first.aws.every((step) => step.status === "reused")).toBe(true);
    expect(second.aws.every((step) => step.status === "reused")).toBe(true);
    expect(deploymentControlPlaneClient.mutations).toEqual([
      "thinkwork-dev-deployment-orchestrator",
      "thinkwork-dev-deployment-orchestrator",
    ]);
    expect(second.github.map((step) => step.status)).toContain("updated");
  });

  it("creates GitHub-free deployment control planes during mutating bootstrap", async () => {
    const deploymentControlPlaneClient =
      new ExistingDeploymentControlPlaneClient();

    const result = await runEnterpriseBootstrap(
      {
        targetDir: tempRepo(),
        customerSlug: "acme",
        stages: ["dev"],
        manifestSha256,
        dryRun: false,
      },
      {
        identity,
        awsClient: new ExistingAwsClient(),
        deploymentControlPlaneClient,
        saveDeployment: vi.fn(),
      },
    );

    expect(result.aws.map((step) => step.target)).toEqual(
      expect.arrayContaining([
        "acme-thinkwork-terraform-state",
        "acme-thinkwork-terraform-locks",
        "acme-thinkwork-release-artifacts",
        "thinkwork-dev-deployment-orchestrator",
      ]),
    );
    expect(deploymentControlPlaneClient.mutations).toEqual([
      "thinkwork-dev-deployment-orchestrator",
    ]);
    expect(result.github).toEqual([]);
  });

  it("fails before GitHub mutation when AWS identity is missing for a mutating run", async () => {
    const githubClient = new ExistingGitHubClient();

    await expect(
      runEnterpriseBootstrap(
        {
          targetDir: tempRepo(),
          customerSlug: "acme",
          repository: "acme/thinkwork-deploy",
          dryRun: false,
        },
        {
          identity: null,
          awsClient: new ExistingAwsClient(),
          deploymentControlPlaneClient:
            new ExistingDeploymentControlPlaneClient(),
          githubClient,
          saveDeployment: vi.fn(),
        },
      ),
    ).rejects.toThrow(/AWS identity is required/);
    expect(githubClient.mutations).toEqual([]);
  });

  it("builds a GitHub OIDC trust policy scoped to repository, environment, and audience", () => {
    const policy = buildGitHubOidcTrustPolicy({
      oidcProviderArn:
        "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com",
      repository: "acme/thinkwork-deploy",
      stage: "prod",
    });

    expect(policy.Statement[0].Condition.StringEquals).toMatchObject({
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub":
        "repo:acme/thinkwork-deploy:environment:prod",
    });
  });

  it("builds a deploy role policy for state, release artifacts, and ThinkWork stage resources", () => {
    const policy = buildEnterpriseDeployRolePolicy({
      accountId: identity.account,
      region: identity.region,
      stage: "prod",
      stateBucket: "acme-thinkwork-terraform-state",
      lockTable: "acme-thinkwork-terraform-locks",
      artifactBucket: "acme-thinkwork-release-artifacts",
    });

    expect(policy.Statement).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Sid: "TerraformStateAndReleaseBuckets",
          Resource: expect.arrayContaining([
            "arn:aws:s3:::acme-thinkwork-terraform-state",
            "arn:aws:s3:::acme-thinkwork-release-artifacts",
          ]),
        }),
        expect.objectContaining({
          Sid: "TerraformStateLocks",
          Resource:
            "arn:aws:dynamodb:us-west-2:111122223333:table/acme-thinkwork-terraform-locks",
        }),
      ]),
    );
    expect(JSON.stringify(policy)).toContain("thinkwork-prod-*");
  });

  it("reports missing GitHub environment permission and preserves generated repo files", async () => {
    const root = tempRepo();

    await expect(
      runEnterpriseBootstrap(
        {
          targetDir: root,
          customerSlug: "acme",
          repository: "acme/thinkwork-deploy",
          stages: ["dev"],
          manifestSha256,
          dryRun: false,
        },
        {
          identity,
          awsClient: new ExistingAwsClient(),
          deploymentControlPlaneClient:
            new ExistingDeploymentControlPlaneClient(),
          githubClient: new PermissionDeniedGitHubClient(),
          saveDeployment: vi.fn(),
        },
      ),
    ).rejects.toThrow(
      "GitHub token is missing environment administration permission for acme/thinkwork-deploy.",
    );
    expect(readFileSync(join(root, "thinkwork.lock"), "utf8")).toContain(
      "acme",
    );
  });

  it("validates missing stage role wiring in the plan", () => {
    expect(() =>
      buildEnterpriseBootstrapPlan(
        {
          targetDir: tempRepo(),
          customerSlug: "acme",
          repository: "acme/thinkwork-deploy",
          stages: ["INVALID_UPPERCASE"],
        },
        identity,
      ),
    ).toThrow(/Invalid stage name/);
  });
});

class ExistingAwsClient implements EnterpriseAwsBootstrapClient {
  async ensureStateBucket(bucket: string): Promise<BootstrapStepResult> {
    return reused(bucket);
  }
  async ensureLockTable(table: string): Promise<BootstrapStepResult> {
    return reused(table);
  }
  async ensureArtifactBucket(bucket: string): Promise<BootstrapStepResult> {
    return reused(bucket);
  }
  async ensureOidcProvider(accountId: string): Promise<BootstrapStepResult> {
    return reused(accountId);
  }
  async ensureDeployRole(
    role: EnterpriseAwsStagePlan,
  ): Promise<BootstrapStepResult> {
    return reused(role.roleArn);
  }
}

class ExistingDeploymentControlPlaneClient
  implements EnterpriseAwsDeploymentControlPlaneClient
{
  mutations: string[] = [];

  async ensureDeploymentControlPlane(
    controlPlane: EnterpriseAwsDeploymentControlPlanePlan,
  ): Promise<BootstrapStepResult> {
    this.mutations.push(controlPlane.stateMachineName);
    return reused(controlPlane.stateMachineName);
  }
}

class ExistingGitHubClient implements EnterpriseGitHubBootstrapClient {
  mutations: string[] = [];

  async ensureEnvironment(
    environment: GitHubEnvironmentPlan,
  ): Promise<BootstrapStepResult> {
    this.mutations.push(`environment:${environment.stage}`);
    return updated(environment.stage);
  }

  async upsertEnvironmentVariables(
    environment: GitHubEnvironmentPlan,
  ): Promise<BootstrapStepResult> {
    this.mutations.push(`vars:${environment.stage}`);
    return updated(`${environment.stage}:vars`);
  }

  async writeRepositoryFiles(targetDir: string): Promise<BootstrapStepResult> {
    this.mutations.push("files");
    return updated(targetDir);
  }

  async dispatchWorkflow(stage: string): Promise<BootstrapStepResult> {
    this.mutations.push(`dispatch:${stage}`);
    return updated(stage);
  }
}

class PermissionDeniedGitHubClient extends ExistingGitHubClient {
  override async ensureEnvironment(): Promise<BootstrapStepResult> {
    throw new Error(
      "GitHub token is missing environment administration permission for acme/thinkwork-deploy.",
    );
  }
}

function reused(target: string): BootstrapStepResult {
  return { target, status: "reused", message: `${target} reused` };
}

function updated(target: string): BootstrapStepResult {
  return { target, status: "updated", message: `${target} updated` };
}
