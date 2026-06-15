import { describe, expect, it } from "vitest";
import {
  buildManagedAppPlan,
  getManagedAppAdapter,
} from "../src/apps/registry";
import { buildApplySummary } from "../src/apply";
import { buildPlanSummary } from "../src/plan";

const digest = "a".repeat(64);
const imageDigest = "1".repeat(64);
const planeImageConfig = {
  imageUri: `artifacts.plane.so/makeplane/plane-aio-commercial@sha256:${imageDigest}`,
  mcpImageUri: `ghcr.io/astral-sh/uv@sha256:${imageDigest}`,
};

function planeDesiredConfig(extra: Record<string, unknown> = {}) {
  return {
    ...planeImageConfig,
    dbUrlSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:plane-db",
    secretKeySecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:plane-secret",
    liveServerSecretKeySecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:plane-live",
    aesSecretKeySecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:plane-aes",
    amqpUrlSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:plane-amqp",
    s3BucketName: "thinkwork-dev-plane",
    publicUrl: "https://plane.example.com",
    certificateArn:
      "arn:aws:acm:us-east-1:123456789012:certificate/example",
    ...extra,
  };
}

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
          brainTenantId: "tenant-1",
          brainInstanceKey: "tenant-abc123",
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
        cognee_brain_tenant_id: "tenant-1",
        cognee_brain_instance_key: "tenant-abc123",
        cognee_brain_storage_tier: "default",
        cognee_private_substrate_mode: true,
        cognee_vector_db_provider: "lancedb",
        cognee_graph_database_provider: "kuzu",
      }),
    );
    expect(summary.smokeContracts).toContainEqual(
      expect.objectContaining({
        command: "plugins/company-brain/smoke/cognee-managed-app-smoke.mjs",
      }),
    );
    expect(summary.statusOutputs).toContain("cognee_endpoint");
    expect(summary.statusOutputs).toContain("cognee_brain_storage_tier");
  });

  it("maps production Brain tier config to Neptune Analytics providers", () => {
    const plan = buildManagedAppPlan({
      appKey: "cognee",
      operation: "ENABLE",
      desiredConfig: {
        imageUri: `public.ecr.aws/thinkwork/cognee@sha256:${imageDigest}`,
        dbPasswordSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:cognee",
        brainTenantId: "tenant-1",
        brainInstanceKey: "tenant-prod",
        brainStorageTier: "production",
        brainS3ArtifactRoot: "s3://brain/tenants/tenant-1/artifacts/",
        brainS3ManifestRoot: "s3://brain/tenants/tenant-1/manifests/",
        brainS3VaultProjectionRoot:
          "s3://brain/tenants/tenant-1/vault-projections/",
        brainArtifactsBucketArn: "arn:aws:s3:::brain",
        brainArtifactsPrefixes: ["tenants/tenant-1/artifacts"],
        neptuneGraphId: "g-123",
        neptuneGraphArn:
          "arn:aws:neptune-graph:us-east-1:123456789012:graph/g-123",
        neptuneEndpoint: "https://g-123.neptune-graph.us-east-1.amazonaws.com",
        bedrockModelResourceArns: [
          "arn:aws:bedrock:us-east-1:123456789012:foundation-model/amazon.titan-embed-text-v2:0",
        ],
      },
    });

    expect(plan.terraformVariables).toEqual(
      expect.objectContaining({
        cognee_backend_mode: "remote",
        cognee_brain_storage_tier: "production",
        cognee_vector_db_provider: "neptune_analytics",
        cognee_graph_database_provider: "neptune_analytics",
        cognee_vector_db_url:
          "https://g-123.neptune-graph.us-east-1.amazonaws.com",
        cognee_graph_database_url:
          "https://g-123.neptune-graph.us-east-1.amazonaws.com",
        cognee_neptune_graph_id: "g-123",
        cognee_neptune_graph_arn:
          "arn:aws:neptune-graph:us-east-1:123456789012:graph/g-123",
        cognee_neptune_endpoint:
          "https://g-123.neptune-graph.us-east-1.amazonaws.com",
        cognee_brain_artifacts_bucket_arn: "arn:aws:s3:::brain",
        cognee_brain_artifacts_prefixes: ["tenants/tenant-1/artifacts"],
      }),
    );
    expect(plan.dataImpact.resources.join("\n")).toMatch(
      /Canonical Company Brain S3 artifacts/,
    );
    expect(plan.dataImpact.resources.join("\n")).toMatch(
      /Production tier uses Cognee-supported Neptune Analytics/,
    );
  });

  it("rejects unsupported Brain storage tiers before Terraform runs", () => {
    expect(() =>
      buildManagedAppPlan({
        appKey: "cognee",
        operation: "ENABLE",
        desiredConfig: {
          imageUri: `public.ecr.aws/thinkwork/cognee@sha256:${imageDigest}`,
          dbPasswordSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:cognee",
          brainStorageTier: "opensearch",
          bedrockModelResourceArns: [
            "arn:aws:bedrock:us-east-1:123456789012:foundation-model/amazon.titan-embed-text-v2:0",
          ],
        },
      }),
    ).toThrow(/brainStorageTier must be default or production/);
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

  it("maps Plane deploy config into Terraform variables and smoke evidence", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-plane-1",
        appKey: "plane",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        desiredConfig: planeDesiredConfig({
          s3BucketName: "thinkwork-plane-files",
          certificateArn:
            "arn:aws:acm:us-east-1:123456789012:certificate/plane",
        }),
      },
    });

    expect(summary.displayName).toBe("Plane");
    expect(summary.terraformVariables).toEqual(
      expect.objectContaining({
        plane_provisioned: true,
        plane_runtime_enabled: true,
        plane_image_uri: planeImageConfig.imageUri,
        plane_mcp_image_uri: planeImageConfig.mcpImageUri,
        plane_public_url: "https://plane.example.com",
        plane_s3_bucket_name: "thinkwork-plane-files",
      }),
    );
    expect(summary.smokeContracts).toContainEqual(
      expect.objectContaining({
        command: "plugins/plane/smoke/plane-managed-app-smoke.mjs",
      }),
    );
    expect(summary.statusOutputs).toContain("plane_url");
    expect(summary.statusOutputs).toContain("plane_rabbitmq_broker_arn");
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
      getManagedAppAdapter("cognee").extractStatus({
        cognee_enabled: { value: true },
        cognee_endpoint: { value: "http://internal-alb" },
        cognee_brain_instance_key: { value: "tenant-abc123" },
        cognee_brain_storage_tier: { value: "production" },
        cognee_vector_db_provider: { value: "neptune_analytics" },
        cognee_graph_database_provider: { value: "neptune_analytics" },
        cognee_neptune_graph_id: { value: "g-123" },
        cognee_s3_artifact_root: {
          value: "s3://brain/tenants/tenant-1/artifacts/",
        },
        cognee_private_substrate_mode: { value: true },
      }),
    ).toEqual(
      expect.objectContaining({
        provisioned: true,
        runtimeEnabled: true,
        endpoint: "http://internal-alb",
        status: "running",
        evidence: expect.objectContaining({
          brainInstanceKey: "tenant-abc123",
          storageTier: "production",
          vectorProvider: "neptune_analytics",
          graphProvider: "neptune_analytics",
          neptuneGraphId: "g-123",
          s3ArtifactRoot: "s3://brain/tenants/tenant-1/artifacts/",
          privateSubstrateMode: true,
        }),
      }),
    );
  });

  it("maps Plane deploy and park plans to retained runtime states", () => {
    const desiredConfig = planeDesiredConfig({ appDesiredCount: 2 });

    expect(
      buildManagedAppPlan({
        appKey: "plane",
        operation: "ENABLE",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        plane_provisioned: true,
        plane_runtime_enabled: true,
        plane_image_uri: planeImageConfig.imageUri,
        plane_public_url: "https://plane.example.com",
        plane_web_desired_count: 2,
      }),
    );
    expect(
      buildManagedAppPlan({
        appKey: "plane",
        operation: "PARK",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        plane_provisioned: true,
        plane_runtime_enabled: false,
      }),
    );
  });

  it("lists destructive Plane resource and data impact", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-plane-destroy",
        appKey: "plane",
        operation: "DESTROY",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
      },
    });

    expect(summary.dataImpact.destructive).toBe(true);
    expect(summary.dataImpact.resources.join("\n")).toMatch(/RabbitMQ/);
    expect(summary.dataImpact.resources.join("\n")).toMatch(/S3/);
    expect(summary.preDestroySteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plane-db-drop" }),
        expect.objectContaining({ id: "plane-object-storage-inventory" }),
        expect.objectContaining({ id: "plane-secret-cleanup" }),
      ]),
    );
    expect(summary.terraformVariables).toEqual({
      plane_provisioned: false,
      plane_runtime_enabled: false,
    });
  });

  it("hydrates Plane images from the verified release manifest contract", () => {
    const summary = buildApplySummary({
      evidenceBucket: "evidence-bucket",
      verifiedManifestDigest: digest,
      input: {
        phase: "apply",
        tenantId: "tenant-1",
        jobId: "job-plane-1",
        appKey: "plane",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        desiredConfig: planeDesiredConfig({
          imageUri: undefined,
          mcpImageUri: undefined,
        }),
        manifestImages: {
          "plane-aio": `artifacts.plane.so/makeplane/plane-aio-commercial@sha256:${"2".repeat(64)}`,
          "plane-mcp-server": `ghcr.io/astral-sh/uv@sha256:${"7".repeat(64)}`,
        },
        planDigest: "b".repeat(64),
      },
    });

    expect(summary.terraformVariables).toEqual(
      expect.objectContaining({
        plane_image_uri: `artifacts.plane.so/makeplane/plane-aio-commercial@sha256:${"2".repeat(64)}`,
        plane_mcp_image_uri: `ghcr.io/astral-sh/uv@sha256:${"7".repeat(64)}`,
      }),
    );
  });

  it("extracts Plane status from Terraform output shapes", () => {
    expect(
      getManagedAppAdapter("plane").extractStatus({
        plane_provisioned: { value: true },
        plane_runtime_enabled: { value: true },
        plane_url: { value: "https://plane.example.com" },
        plane_rabbitmq_broker_arn: {
          value: "arn:aws:amazonmq:us-east-1:123456789012:broker:plane",
        },
        plane_storage_bucket_name: { value: "thinkwork-dev-plane" },
      }),
    ).toEqual(
      expect.objectContaining({
        provisioned: true,
        runtimeEnabled: true,
        endpoint: "https://plane.example.com",
        status: "running",
        evidence: expect.objectContaining({
          rabbitmqBrokerArn:
            "arn:aws:amazonmq:us-east-1:123456789012:broker:plane",
          storageBucketName: "thinkwork-dev-plane",
        }),
      }),
    );
  });
});
