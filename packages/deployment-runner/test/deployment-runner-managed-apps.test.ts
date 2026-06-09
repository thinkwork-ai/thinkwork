import { describe, expect, it } from "vitest";
import {
  buildManagedAppPlan,
  getManagedAppAdapter,
} from "../src/apps/registry";
import { buildApplySummary } from "../src/apply";
import { buildPlanSummary } from "../src/plan";

const digest = "a".repeat(64);
const imageDigest = "1".repeat(64);

describe("managed app deployment adapters", () => {
  it("maps Cognee deploy config into Terraform variables and smoke evidence", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-1",
        appKey: "cognee",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        desiredConfig: {
          imageUri: `public.ecr.aws/thinkwork/cognee@sha256:${imageDigest}`,
          dbPasswordSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:cognee",
          dbName: "thinkwork_cognee",
          backendMode: "dogfood",
          bedrockModelResourceArns: [
            "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0",
          ],
        },
      },
    });

    expect(summary.displayName).toBe("Cognee");
    expect(summary.terraformVariables).toEqual(
      expect.objectContaining({
        enable_cognee: true,
        cognee_image_uri: `public.ecr.aws/thinkwork/cognee@sha256:${imageDigest}`,
        cognee_db_password_secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:cognee",
        cognee_db_name: "thinkwork_cognee",
        cognee_backend_mode: "dogfood",
      }),
    );
    expect(summary.smokeContracts).toContainEqual(
      expect.objectContaining({
        command: "scripts/smoke/cognee-managed-app-smoke.mjs",
      }),
    );
    expect(summary.statusOutputs).toContain("cognee_endpoint");
  });

  it("fails Cognee enable plans without required image and secrets", () => {
    expect(() =>
      buildManagedAppPlan({
        appKey: "cognee",
        operation: "ENABLE",
        desiredConfig: {},
      }),
    ).toThrow(/bedrockModelResourceArns|imageUri|dbPasswordSecretArn/);
  });

  it("hydrates managed app images from the verified release manifest contract", () => {
    const baseInput = {
      phase: "plan" as const,
      schemaVersion: 1,
      contract: "thinkwork.deployment.controller.v1",
      tenantId: "tenant-1",
      jobId: "job-1",
      appKey: "cognee" as const,
      operation: "ENABLE" as const,
      release: {
        version: "1.2.3",
        manifestUrl:
          "https://github.com/thinkwork-ai/thinkwork/releases/download/v1.2.3/thinkwork-release.json",
        manifestSha256: digest,
      },
      releaseVersion: "1.2.3",
      manifestDigest: digest,
      desiredConfigVersion: "v1",
      desiredConfig: {
        dbPasswordSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:cognee",
        bedrockModelResourceArns: [
          "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        ],
      },
      evidence: {
        bucket: "evidence-bucket",
        prefix: "managed-apps/cognee/job-1/plan",
      },
    };

    const first = buildPlanSummary({
      evidenceBucket: "fallback-bucket",
      input: {
        ...baseInput,
        manifestImages: {
          cognee: `public.ecr.aws/thinkwork/cognee@sha256:${"1".repeat(64)}`,
        },
      },
    });
    const second = buildPlanSummary({
      evidenceBucket: "fallback-bucket",
      input: {
        ...baseInput,
        manifestImages: {
          cognee: `public.ecr.aws/thinkwork/cognee@sha256:${"2".repeat(64)}`,
        },
      },
    });

    expect(first.evidence).toEqual({
      bucket: "evidence-bucket",
      prefix: "managed-apps/cognee/job-1/plan",
    });
    expect(first.releaseManifestUrl).toBe(baseInput.release.manifestUrl);
    expect(first.terraformVariables).toEqual(
      expect.objectContaining({
        cognee_image_uri: `public.ecr.aws/thinkwork/cognee@sha256:${"1".repeat(64)}`,
      }),
    );
    expect(first.planDigest).not.toBe(second.planDigest);
  });

  it("blocks managed app deploys when the release manifest lacks the app image", () => {
    expect(() =>
      buildPlanSummary({
        evidenceBucket: "evidence-bucket",
        input: {
          phase: "plan",
          tenantId: "tenant-1",
          jobId: "job-1",
          appKey: "twenty",
          operation: "ENABLE",
          releaseVersion: "1.2.3",
          manifestDigest: digest,
          desiredConfigVersion: "v1",
          desiredConfig: {
            dbUrlSecretArn:
              "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-db",
            encryptionKeySecretArn:
              "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-key",
            publicUrl: "https://crm.example.com",
            certificateArn:
              "arn:aws:acm:us-east-1:123456789012:certificate/example",
          },
          manifestImages: {},
        },
      }),
    ).toThrow(/Twenty imageUri/);
  });

  it("lists destructive Twenty resource and data impact", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-2",
        appKey: "twenty",
        operation: "DESTROY",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
      },
    });

    expect(summary.dataImpact.destructive).toBe(true);
    expect(summary.dataImpact.resources.join("\n")).toMatch(
      /database.*DB URL secret.*encryption key/i,
    );
    expect(summary.dataImpact.resources.join("\n")).toMatch(
      /ElastiCache.*Valkey|Redis/i,
    );
    expect(summary.preDestroySteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "twenty-db-drop" }),
        expect.objectContaining({ id: "twenty-secret-cleanup" }),
      ]),
    );
    expect(summary.terraformVariables).toEqual({
      twenty_provisioned: false,
      twenty_runtime_enabled: false,
    });
  });

  it("maps Kestra deploy and park plans to retained runtime states", () => {
    const desiredConfig = {
      imageUri: `public.ecr.aws/thinkwork/kestra@sha256:${imageDigest}`,
      dbPasswordSecretArn:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-db",
      basicAuthSecretArn:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-auth",
      publicUrl: "https://orchestrate.example.com",
      certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/example",
      namespacePrefix: "thinkwork",
      desiredCount: 1,
    };

    const enablePlan = buildManagedAppPlan({
      appKey: "kestra",
      operation: "ENABLE",
      desiredConfig,
    });

    expect(enablePlan.terraformVariables).toEqual(
      expect.objectContaining({
        kestra_provisioned: true,
        kestra_runtime_enabled: true,
        kestra_image_uri: `public.ecr.aws/thinkwork/kestra@sha256:${imageDigest}`,
        kestra_db_password_secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-db",
        kestra_basic_auth_secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-auth",
        kestra_public_url: "https://orchestrate.example.com",
        kestra_certificate_arn:
          "arn:aws:acm:us-east-1:123456789012:certificate/example",
        kestra_namespace_prefix: "thinkwork",
      }),
    );
    expect(enablePlan.smokeContracts).toContainEqual(
      expect.objectContaining({
        command: "scripts/smoke/kestra-managed-app-smoke.mjs",
      }),
    );
    expect(enablePlan.statusOutputs).toContain("kestra_url");

    expect(
      buildManagedAppPlan({
        appKey: "kestra",
        operation: "PARK",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        kestra_provisioned: true,
        kestra_runtime_enabled: false,
      }),
    );
  });

  it("rejects incomplete or mutable Kestra deploy config", () => {
    expect(() =>
      buildManagedAppPlan({
        appKey: "kestra",
        operation: "ENABLE",
        desiredConfig: {},
      }),
    ).toThrow(/Kestra imageUri/);

    expect(() =>
      buildManagedAppPlan({
        appKey: "kestra",
        operation: "ENABLE",
        desiredConfig: {
          imageUri: "public.ecr.aws/thinkwork/kestra:latest",
          dbPasswordSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-db",
          basicAuthSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-auth",
          publicUrl: "https://orchestrate.example.com",
          certificateArn:
            "arn:aws:acm:us-east-1:123456789012:certificate/example",
        },
      }),
    ).toThrow(/immutable sha256 digest/);

    expect(() =>
      buildManagedAppPlan({
        appKey: "kestra",
        operation: "ENABLE",
        desiredConfig: {
          imageUri: `public.ecr.aws/thinkwork/kestra@sha256:${imageDigest}`,
          basicAuthSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:kestra-auth",
          publicUrl: "https://orchestrate.example.com",
          certificateArn:
            "arn:aws:acm:us-east-1:123456789012:certificate/example",
        },
      }),
    ).toThrow(/Kestra dbPasswordSecretArn/);
  });

  it("lists destructive Kestra app data, credential, and MCP impact", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-3",
        appKey: "kestra",
        operation: "DESTROY",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
      },
    });

    expect(summary.displayName).toBe("Kestra");
    expect(summary.dataImpact.destructive).toBe(true);
    expect(summary.dataImpact.resources.join("\n")).toMatch(
      /flow definitions.*execution history/i,
    );
    expect(summary.dataImpact.resources.join("\n")).toMatch(
      /basic-auth service credential.*MCP bearer credential/i,
    );
    expect(summary.dataImpact.resources.join("\n")).toMatch(
      /managed Kestra MCP server row/i,
    );
    expect(summary.preDestroySteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "kestra-db-drop" }),
        expect.objectContaining({ id: "kestra-storage-cleanup" }),
        expect.objectContaining({ id: "kestra-managed-mcp-cleanup" }),
      ]),
    );
    expect(summary.terraformVariables).toEqual({
      kestra_provisioned: false,
      kestra_runtime_enabled: false,
    });
  });

  it("maps Twenty deploy and park plans to distinct runtime states", () => {
    const desiredConfig = {
      imageUri: `public.ecr.aws/thinkwork/twenty@sha256:${imageDigest}`,
      dbUrlSecretArn:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-db",
      encryptionKeySecretArn:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-key",
      publicUrl: "https://crm.example.com",
      certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/example",
      serverDesiredCount: 2,
      workerDesiredCount: 1,
    };

    expect(
      buildManagedAppPlan({
        appKey: "twenty",
        operation: "ENABLE",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        twenty_provisioned: true,
        twenty_runtime_enabled: true,
        twenty_public_url: "https://crm.example.com",
        twenty_server_desired_count: 2,
      }),
    );
    expect(
      buildManagedAppPlan({
        appKey: "twenty",
        operation: "PARK",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        twenty_provisioned: true,
        twenty_runtime_enabled: false,
      }),
    );
  });

  it("rebuilds apply summaries from the approved config and manifest image", () => {
    const summary = buildApplySummary({
      evidenceBucket: "evidence-bucket",
      verifiedManifestDigest: digest,
      input: {
        phase: "apply",
        tenantId: "tenant-1",
        jobId: "job-2",
        appKey: "twenty",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        desiredConfig: {
          dbUrlSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-db",
          encryptionKeySecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-key",
          publicUrl: "https://crm.example.com",
          certificateArn:
            "arn:aws:acm:us-east-1:123456789012:certificate/example",
        },
        manifestImages: {
          "twenty-crm": `public.ecr.aws/thinkwork/twenty@sha256:${imageDigest}`,
        },
        planDigest: "b".repeat(64),
      },
    });

    expect(summary.terraformVariables).toEqual(
      expect.objectContaining({
        twenty_image_uri: `public.ecr.aws/thinkwork/twenty@sha256:${imageDigest}`,
      }),
    );
  });

  it("extracts app status from Terraform output shapes", () => {
    expect(
      getManagedAppAdapter("twenty").extractStatus({
        twenty_provisioned: { value: true },
        twenty_runtime_enabled: { value: false },
        twenty_url: { value: "https://crm.example.com" },
      }),
    ).toEqual(
      expect.objectContaining({
        provisioned: true,
        runtimeEnabled: false,
        endpoint: "https://crm.example.com",
        status: "parked",
      }),
    );
    expect(
      getManagedAppAdapter("kestra").extractStatus({
        kestra_provisioned: { value: true },
        kestra_runtime_enabled: { value: true },
        kestra_url: { value: "https://orchestrate.example.com" },
        kestra_cluster_arn: { value: "arn:aws:ecs:cluster/kestra" },
        kestra_service_name: { value: "thinkwork-dev-kestra" },
        kestra_log_group_name: { value: "/aws/ecs/thinkwork-dev-kestra" },
      }),
    ).toEqual(
      expect.objectContaining({
        provisioned: true,
        runtimeEnabled: true,
        endpoint: "https://orchestrate.example.com",
        status: "running",
        evidence: expect.objectContaining({
          clusterArn: "arn:aws:ecs:cluster/kestra",
          serviceName: "thinkwork-dev-kestra",
          logGroupName: "/aws/ecs/thinkwork-dev-kestra",
        }),
      }),
    );
    expect(
      getManagedAppAdapter("cognee").extractStatus({
        cognee_enabled: { value: true },
        cognee_endpoint: { value: "http://internal-alb" },
      }),
    ).toEqual(
      expect.objectContaining({
        provisioned: true,
        runtimeEnabled: true,
        endpoint: "http://internal-alb",
        status: "running",
      }),
    );
  });
});
