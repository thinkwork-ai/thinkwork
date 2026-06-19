import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildN8nPackageImageBuildContract } from "../src/deployment/image-build";
import { normalizeN8nPackageConfig } from "../src/package-config";

const baseImageUri = `public.ecr.aws/thinkwork/n8n@sha256:${"1".repeat(64)}`;
const packageImageUri = `123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork/n8n@sha256:${"2".repeat(64)}`;

describe("n8n package image build contract", () => {
  it("requires digest-pinned output images tied to the normalized package digest", () => {
    const packageConfig = normalizeN8nPackageConfig([
      "zod@3.25.76",
      "lodash@4.17.21",
    ]);
    const contract = buildN8nPackageImageBuildContract({
      tenantId: "tenant-1",
      pluginVersion: "1.2.3",
      baseImageUri,
      taskRunnersEnabled: true,
      customPackageSpecs: ["lodash@4.17.21", "zod@3.25.76"],
      packageConfigDigest: packageConfig.digest,
      packageImageConfigDigest: packageConfig.digest,
      packageImageUri,
    });

    expect(contract.required).toBe(true);
    expect(contract.outputImageUri).toBe(packageImageUri);
    expect(contract.outputImageDigest).toBe("2".repeat(64));
    expect(contract.packageConfig.digest).toBe(packageConfig.digest);
    expect(contract.nodeFunctionAllowExternal).toBe("lodash,zod");
    expect(contract.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the idempotency key when package config changes", () => {
    const first = buildN8nPackageImageBuildContract({
      tenantId: "tenant-1",
      pluginVersion: "1.2.3",
      baseImageUri,
      taskRunnersEnabled: true,
      customPackageSpecs: ["lodash@4.17.21"],
      packageImageUri,
    });
    const second = buildN8nPackageImageBuildContract({
      tenantId: "tenant-1",
      pluginVersion: "1.2.3",
      baseImageUri,
      taskRunnersEnabled: true,
      customPackageSpecs: ["date-fns@4.1.0"],
      packageImageUri,
    });

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it("rejects missing or mismatched package image approvals before apply", () => {
    const packageConfig = normalizeN8nPackageConfig(["lodash@4.17.21"]);

    expect(() =>
      buildN8nPackageImageBuildContract({
        tenantId: "tenant-1",
        pluginVersion: "1.2.3",
        baseImageUri,
        taskRunnersEnabled: true,
        customPackageSpecs: ["lodash@4.17.21"],
        packageConfigDigest: packageConfig.digest,
      }),
    ).toThrow(/packageImageUri is required/);

    expect(() =>
      buildN8nPackageImageBuildContract({
        tenantId: "tenant-1",
        pluginVersion: "1.2.3",
        baseImageUri,
        taskRunnersEnabled: true,
        customPackageSpecs: ["lodash@4.17.21"],
        packageConfigDigest: "0".repeat(64),
        packageImageUri,
      }),
    ).toThrow(/packageConfigDigest must match/);
  });

  it("keeps runtime secrets out of image build inputs", () => {
    const contract = buildN8nPackageImageBuildContract({
      tenantId: "tenant-1",
      pluginVersion: "1.2.3",
      baseImageUri,
      taskRunnersEnabled: true,
      customPackageSpecs: ["lodash@4.17.21"],
      packageImageUri,
    });

    expect(contract.security.runtimeSecretsIncluded).toBe(false);
    expect(contract.security.buildSecretKeys).toEqual([]);
    expect(JSON.stringify(contract)).not.toMatch(
      /DATABASE_URL|N8N_ENCRYPTION_KEY|OPERATOR_PASSWORD|SERVICE_CREDENTIAL/,
    );
  });

  it("ships runtime templates for n8n module resolution and task-runner allow lists", () => {
    const dockerfile = readFileSync("runtime/Dockerfile", "utf8");
    const taskRunnerTemplate = readFileSync(
      "runtime/n8n-task-runners.json.template",
      "utf8",
    );

    expect(dockerfile).toContain(
      "/usr/local/lib/node_modules/n8n/node_modules",
    );
    expect(taskRunnerTemplate).toContain("NODE_FUNCTION_ALLOW_EXTERNAL");
    expect(taskRunnerTemplate).toContain("{{NODE_FUNCTION_ALLOW_EXTERNAL}}");
  });
});
