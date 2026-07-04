import { describe, expect, it } from "vitest";
import {
  buildManagedAppPlan,
  getManagedAppAdapter,
} from "../src/apps/registry";
import { buildApplySummary } from "../src/apply";
import { buildPlanSummary } from "../src/plan";
import { normalizeN8nPackageConfig } from "@thinkwork/plugin-n8n/package-config";

const digest = "a".repeat(64);
const imageDigest = "1".repeat(64);
const n8nPackageImageDigest = "4".repeat(64);
const n8nPackageImageUri = `123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork/n8n@sha256:${n8nPackageImageDigest}`;

function n8nDesiredConfig(extra: Record<string, unknown> = {}) {
  return {
    imageUri: `public.ecr.aws/thinkwork/n8n@sha256:${imageDigest}`,
    databaseAdminSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-admin",
    databaseUrlSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-url",
    encryptionKeySecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-key",
    operatorSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-operator",
    serviceCredentialSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
    agentStepBridgeCredentialSecretArn:
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-bridge",
    storageBucketName: "thinkwork-dev-n8n",
    publicUrl: "https://n8n.example.com",
    certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/n8n",
    ...extra,
  };
}

describe("managed app deployment adapters", () => {
  it("maps n8n deploy config into Terraform variables and smoke evidence", () => {
    const packageConfig = normalizeN8nPackageConfig([
      "luxon@3.7.2",
      "zod@3.25.76",
    ]);
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-n8n-1",
        appKey: "n8n",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        desiredConfig: n8nDesiredConfig({
          customPackageSpecs: ["zod@3.25.76", "luxon@3.7.2"],
          packageConfigDigest: packageConfig.digest,
          packageImageConfigDigest: packageConfig.digest,
          packageImageUri: n8nPackageImageUri,
        }),
      },
    });

    expect(summary.displayName).toBe("n8n");
    expect(summary.terraformVariables).toEqual(
      expect.objectContaining({
        n8n_provisioned: true,
        n8n_runtime_enabled: true,
        n8n_image_uri: n8nPackageImageUri,
        n8n_database_name: "thinkwork_n8n",
        n8n_database_admin_secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-admin",
        n8n_database_url_secret_arn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-url",
        n8n_storage_bucket_name: "thinkwork-dev-n8n",
        n8n_storage_prefix: "managed-apps/n8n",
        n8n_main_desired_count: 1,
        n8n_worker_desired_count: 1,
        n8n_queue_mode: true,
        n8n_task_runners_enabled: true,
        n8n_custom_package_specs: packageConfig.packageSpecs,
        n8n_package_config_digest: packageConfig.digest,
      }),
    );
    expect(summary.imageBuild).toEqual(
      expect.objectContaining({
        required: true,
        packageConfigDigest: packageConfig.digest,
        outputImageUri: n8nPackageImageUri,
        nodeFunctionAllowExternal: "luxon,zod",
      }),
    );
    expect(summary.smokeContracts).toContainEqual(
      expect.objectContaining({
        command: "plugins/n8n/smoke/n8n-managed-app-smoke.mjs",
      }),
    );
    expect(summary.smokeContracts).toContainEqual(
      expect.objectContaining({
        command: "plugins/n8n/smoke/n8n-agent-step-bridge-smoke.mjs",
        required: false,
      }),
    );
    expect(summary.statusOutputs).toContain("n8n_url");
    expect(summary.statusOutputs).toContain("n8n_database_name");
    expect(summary.statusOutputs).toContain("n8n_valkey_endpoint");
    expect(summary.statusOutputs).toContain("n8n_package_config_digest");
  });

  it("changes n8n plan digest when custom package config changes", () => {
    const lodashConfig = normalizeN8nPackageConfig(["lodash@4.17.21"]);
    const dateFnsConfig = normalizeN8nPackageConfig(["date-fns@4.1.0"]);
    const commonInput = {
      phase: "plan" as const,
      tenantId: "tenant-1",
      jobId: "job-n8n-package",
      appKey: "n8n" as const,
      operation: "ENABLE" as const,
      releaseVersion: "1.2.3",
      manifestDigest: digest,
      desiredConfigVersion: "v1",
    };

    const first = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        ...commonInput,
        desiredConfig: n8nDesiredConfig({
          customPackageSpecs: ["lodash@4.17.21"],
          packageConfigDigest: lodashConfig.digest,
          packageImageConfigDigest: lodashConfig.digest,
          packageImageUri: n8nPackageImageUri,
        }),
      },
    });
    const second = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        ...commonInput,
        desiredConfig: n8nDesiredConfig({
          customPackageSpecs: ["date-fns@4.1.0"],
          packageConfigDigest: dateFnsConfig.digest,
          packageImageConfigDigest: dateFnsConfig.digest,
          packageImageUri: n8nPackageImageUri,
        }),
      },
    });

    expect(first.planDigest).not.toBe(second.planDigest);
    expect(first.terraformVariables).toEqual(
      expect.objectContaining({
        n8n_image_uri: n8nPackageImageUri,
        n8n_package_config_digest: lodashConfig.digest,
        n8n_custom_package_specs: ["lodash@4.17.21"],
      }),
    );
    expect(first.imageBuild).toEqual(
      expect.objectContaining({
        packageConfigDigest: lodashConfig.digest,
        packageNames: ["lodash"],
        security: expect.objectContaining({
          runtimeSecretsIncluded: false,
          buildSecretKeys: [],
        }),
      }),
    );
  });

  it("hydrates managed app images from the verified release manifest contract", () => {
    const baseInput = {
      phase: "plan" as const,
      schemaVersion: 1,
      contract: "thinkwork.deployment.controller.v1",
      tenantId: "tenant-1",
      jobId: "job-1",
      appKey: "n8n" as const,
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
      desiredConfig: n8nDesiredConfig({ imageUri: "" }),
      evidence: {
        bucket: "evidence-bucket",
        prefix: "managed-apps/n8n/job-1/plan",
      },
    };

    const first = buildPlanSummary({
      evidenceBucket: "fallback-bucket",
      input: {
        ...baseInput,
        manifestImages: {
          n8n: `public.ecr.aws/thinkwork/n8n@sha256:${"1".repeat(64)}`,
        },
      },
    });
    const second = buildPlanSummary({
      evidenceBucket: "fallback-bucket",
      input: {
        ...baseInput,
        manifestImages: {
          n8n: `public.ecr.aws/thinkwork/n8n@sha256:${"2".repeat(64)}`,
        },
      },
    });

    expect(first.evidence).toEqual({
      bucket: "evidence-bucket",
      prefix: "managed-apps/n8n/job-1/plan",
    });
    expect(first.releaseManifestUrl).toBe(baseInput.release.manifestUrl);
    expect(first.terraformVariables).toEqual(
      expect.objectContaining({
        n8n_image_uri: `public.ecr.aws/thinkwork/n8n@sha256:${"1".repeat(64)}`,
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

  it("fails n8n enable plans without required pinned image and secrets", () => {
    expect(() =>
      buildManagedAppPlan({
        appKey: "n8n",
        operation: "ENABLE",
        desiredConfig: {},
      }),
    ).toThrow(/n8n imageUri|n8n databaseAdminSecretArn/);
    expect(() =>
      buildManagedAppPlan({
        appKey: "n8n",
        operation: "ENABLE",
        desiredConfig: n8nDesiredConfig({
          imageUri: "public.ecr.aws/thinkwork/n8n:latest",
        }),
      }),
    ).toThrow(/n8n imageUri must be pinned/);
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

  it("lists destructive n8n resource and data impact", () => {
    const summary = buildPlanSummary({
      evidenceBucket: "evidence-bucket",
      input: {
        phase: "plan",
        tenantId: "tenant-1",
        jobId: "job-n8n-destroy",
        appKey: "n8n",
        operation: "DESTROY",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
      },
    });

    expect(summary.dataImpact.destructive).toBe(true);
    expect(summary.dataImpact.resources.join("\n")).toMatch(/main and worker/);
    expect(summary.dataImpact.resources.join("\n")).toMatch(/thinkwork_n8n/);
    expect(summary.dataImpact.resources.join("\n")).toMatch(/Valkey|Redis/);
    expect(summary.dataImpact.resources.join("\n")).toMatch(
      /service credential/,
    );
    expect(summary.preDestroySteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "n8n-db-drop" }),
        expect.objectContaining({ id: "n8n-storage-inventory" }),
        expect.objectContaining({ id: "n8n-service-credential-cleanup" }),
      ]),
    );
    expect(summary.terraformVariables).toEqual({
      n8n_provisioned: false,
      n8n_runtime_enabled: false,
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

  it("maps n8n deploy and park plans to retained queue-mode states", () => {
    const desiredConfig = n8nDesiredConfig({
      mainDesiredCount: 2,
      workerDesiredCount: 3,
    });

    expect(
      buildManagedAppPlan({
        appKey: "n8n",
        operation: "ENABLE",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        n8n_provisioned: true,
        n8n_runtime_enabled: true,
        n8n_public_url: "https://n8n.example.com",
        n8n_main_desired_count: 2,
        n8n_worker_desired_count: 3,
        n8n_queue_mode: true,
      }),
    );
    expect(
      buildManagedAppPlan({
        appKey: "n8n",
        operation: "PARK",
        desiredConfig,
      }).terraformVariables,
    ).toEqual(
      expect.objectContaining({
        n8n_provisioned: true,
        n8n_runtime_enabled: false,
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

  it("hydrates n8n images from the verified release manifest contract", () => {
    const summary = buildApplySummary({
      evidenceBucket: "evidence-bucket",
      verifiedManifestDigest: digest,
      input: {
        phase: "apply",
        tenantId: "tenant-1",
        jobId: "job-n8n-1",
        appKey: "n8n",
        operation: "ENABLE",
        releaseVersion: "1.2.3",
        manifestDigest: digest,
        desiredConfigVersion: "v1",
        desiredConfig: n8nDesiredConfig({ imageUri: undefined }),
        manifestImages: {
          "n8n-runtime": `public.ecr.aws/thinkwork/n8n@sha256:${"3".repeat(64)}`,
        },
        planDigest: "b".repeat(64),
      },
    });

    expect(summary.terraformVariables).toEqual(
      expect.objectContaining({
        n8n_image_uri: `public.ecr.aws/thinkwork/n8n@sha256:${"3".repeat(64)}`,
      }),
    );
  });

  it("rejects n8n apply when the approved package digest is stale", () => {
    expect(() =>
      buildApplySummary({
        evidenceBucket: "evidence-bucket",
        verifiedManifestDigest: digest,
        input: {
          phase: "apply",
          tenantId: "tenant-1",
          jobId: "job-n8n-stale-package",
          appKey: "n8n",
          operation: "ENABLE",
          releaseVersion: "1.2.3",
          manifestDigest: digest,
          desiredConfigVersion: "v1",
          desiredConfig: n8nDesiredConfig({
            customPackageSpecs: ["lodash@4.17.21"],
            packageConfigDigest: "0".repeat(64),
            packageImageUri: n8nPackageImageUri,
          }),
          planDigest: "b".repeat(64),
        },
      }),
    ).toThrow(/packageConfigDigest must match/);
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
  });

  it("extracts n8n status from Terraform output shapes", () => {
    expect(
      getManagedAppAdapter("n8n").extractStatus({
        n8n_provisioned: { value: true },
        n8n_runtime_enabled: { value: true },
        n8n_url: { value: "https://n8n.example.com" },
        n8n_database_name: { value: "thinkwork_n8n" },
        n8n_valkey_endpoint: { value: "redis://n8n-cache.example.com:6379" },
        n8n_package_config_digest: { value: "package-digest-1" },
        n8n_service_credential_secret_arn: {
          value:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
        },
        n8n_agent_step_bridge_credential_secret_arn: {
          value:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-bridge",
        },
      }),
    ).toEqual(
      expect.objectContaining({
        provisioned: true,
        runtimeEnabled: true,
        endpoint: "https://n8n.example.com",
        status: "running",
        evidence: expect.objectContaining({
          databaseName: "thinkwork_n8n",
          valkeyEndpoint: "redis://n8n-cache.example.com:6379",
          packageConfigDigest: "package-digest-1",
          serviceCredentialSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
          agentStepBridgeCredentialSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-bridge",
        }),
      }),
    );
  });
});
