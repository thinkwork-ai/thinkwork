import { describe, expect, it } from "vitest";
import {
  buildManagedAppPlan,
  getManagedAppAdapter,
} from "../src/apps/registry";
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
