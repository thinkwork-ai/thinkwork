import {
  type ManagedAppAdapter,
  type RequiredManagedAppInput,
} from "@thinkwork/deployment-runner/apps/registry";
import {
  boolOutput,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireDigestImage,
  requireStringInput,
  stringOutput,
} from "@thinkwork/deployment-runner/apps/utils";
import {
  buildN8nPackageImageBuildContract,
  n8nPackageImageBuildSummary,
} from "./image-build";
import {
  assertN8nPackageConfigDigest,
  normalizeN8nPackageConfig,
} from "../package-config";

const smokeContracts = [
  {
    id: "n8n-runtime-health",
    command: "plugins/n8n/smoke/n8n-managed-app-smoke.mjs",
    required: true,
  },
] as const;

const statusOutputs = [
  "n8n_provisioned",
  "n8n_runtime_enabled",
  "n8n_url",
  "n8n_alb_arn",
  "n8n_target_group_arn",
  "n8n_cluster_arn",
  "n8n_main_service_name",
  "n8n_worker_service_name",
  "n8n_main_log_group_name",
  "n8n_worker_log_group_name",
  "n8n_database_name",
  "n8n_database_secret_arn",
  "n8n_valkey_endpoint",
  "n8n_storage_bucket_name",
  "n8n_storage_prefix",
  "n8n_image_digest",
  "n8n_package_config_digest",
  "n8n_service_credential_secret_arn",
] as const;

const DEFAULT_DATABASE_NAME = "thinkwork_n8n";
const DEFAULT_STORAGE_PREFIX = "managed-apps/n8n";

const provisionRequiredInputs: RequiredManagedAppInput[] = [
  {
    key: "imageUri",
    description: "Thin ThinkWork n8n wrapper image URI pinned with @sha256.",
    terraformVariable: "n8n_image_uri",
  },
  {
    key: "databaseAdminSecretArn",
    description:
      "Secrets Manager ARN for an admin database credential allowed to create the n8n database and role.",
    terraformVariable: "n8n_database_admin_secret_arn",
    secret: true,
  },
  {
    key: "databaseUrlSecretArn",
    description:
      "Secrets Manager ARN containing the least-privilege n8n PostgreSQL connection URL.",
    terraformVariable: "n8n_database_url_secret_arn",
    secret: true,
  },
  {
    key: "encryptionKeySecretArn",
    description: "Secrets Manager ARN containing N8N_ENCRYPTION_KEY.",
    terraformVariable: "n8n_encryption_key_secret_arn",
    secret: true,
  },
  {
    key: "operatorSecretArn",
    description:
      "Secrets Manager ARN containing the shared native n8n operator account credential.",
    terraformVariable: "n8n_operator_secret_arn",
    secret: true,
  },
  {
    key: "serviceCredentialSecretArn",
    description:
      "Secrets Manager ARN containing the tenant service credential used by the native n8n MCP integration.",
    terraformVariable: "n8n_service_credential_secret_arn",
    secret: true,
  },
  {
    key: "storageBucketName",
    description: "S3 bucket name used for n8n binary data and runtime files.",
    terraformVariable: "n8n_storage_bucket_name",
  },
  {
    key: "publicUrl",
    description: "Public HTTPS origin for n8n.",
    terraformVariable: "n8n_public_url",
  },
  {
    key: "certificateArn",
    description: "ACM certificate ARN for the n8n public HTTPS listener.",
    terraformVariable: "n8n_certificate_arn",
  },
];

export const n8nAdapter: ManagedAppAdapter = {
  appKey: "n8n",
  displayName: "n8n",
  description:
    "Self-hosted n8n workflow automation runtime with queue workers, retained workflow data, and native MCP integration.",
  catalogVisible: false,
  terraformModulePath: "plugins/n8n/terraform/n8n",
  requiredInputs(operation) {
    return operation === "DESTROY" ? [] : provisionRequiredInputs;
  },
  buildTerraformVariables({ operation, desiredConfig }) {
    if (operation === "DESTROY") {
      return {
        n8n_provisioned: false,
        n8n_runtime_enabled: false,
      };
    }

    const runtimeEnabled = operation !== "PARK";
    const packageConfig = normalizeN8nPackageConfig(desiredConfig);
    assertN8nPackageConfigDigest({
      expectedDigest: desiredConfig?.packageConfigDigest,
      actualDigest: packageConfig.digest,
      fieldName: "n8n packageConfigDigest",
    });
    assertN8nPackageConfigDigest({
      expectedDigest: desiredConfig?.packageImageConfigDigest,
      actualDigest: packageConfig.digest,
      fieldName: "n8n packageImageConfigDigest",
    });
    const baseImageUri = requireDigestImage(
      desiredConfig,
      "imageUri",
      "n8n imageUri",
    );
    const packageImageUri = optionalString(desiredConfig, "packageImageUri");
    if (packageImageUri && packageConfig.packageSpecs.length === 0) {
      throw new Error(
        "n8n packageImageUri requires at least one custom package spec",
      );
    }
    const resolvedImageUri =
      packageConfig.packageSpecs.length > 0
        ? requireDigestImage(
            desiredConfig,
            "packageImageUri",
            "n8n packageImageUri",
          )
        : baseImageUri;
    const packageConfigDigest =
      packageConfig.packageSpecs.length > 0 ||
      desiredConfig?.packageConfigDigest !== undefined
        ? packageConfig.digest
        : undefined;

    return compactObject({
      n8n_provisioned: true,
      n8n_runtime_enabled: runtimeEnabled,
      n8n_image_uri: resolvedImageUri,
      n8n_database_admin_secret_arn: requireStringInput(
        desiredConfig,
        "databaseAdminSecretArn",
        "n8n databaseAdminSecretArn",
      ),
      n8n_database_url_secret_arn: requireStringInput(
        desiredConfig,
        "databaseUrlSecretArn",
        "n8n databaseUrlSecretArn",
      ),
      n8n_database_name:
        optionalString(desiredConfig, "databaseName") ?? DEFAULT_DATABASE_NAME,
      n8n_database_username: optionalString(desiredConfig, "databaseUsername"),
      n8n_encryption_key_secret_arn: requireStringInput(
        desiredConfig,
        "encryptionKeySecretArn",
        "n8n encryptionKeySecretArn",
      ),
      n8n_operator_secret_arn: requireStringInput(
        desiredConfig,
        "operatorSecretArn",
        "n8n operatorSecretArn",
      ),
      n8n_service_credential_secret_arn: requireStringInput(
        desiredConfig,
        "serviceCredentialSecretArn",
        "n8n serviceCredentialSecretArn",
      ),
      n8n_storage_bucket_name: requireStringInput(
        desiredConfig,
        "storageBucketName",
        "n8n storageBucketName",
      ),
      n8n_storage_prefix:
        optionalString(desiredConfig, "storagePrefix") ??
        DEFAULT_STORAGE_PREFIX,
      n8n_public_url: requireStringInput(
        desiredConfig,
        "publicUrl",
        "n8n publicUrl",
      ),
      n8n_certificate_arn: requireStringInput(
        desiredConfig,
        "certificateArn",
        "n8n certificateArn",
      ),
      n8n_domain: optionalString(desiredConfig, "domain"),
      n8n_main_desired_count:
        optionalNumber(desiredConfig, "mainDesiredCount") ?? 1,
      n8n_worker_desired_count:
        optionalNumber(desiredConfig, "workerDesiredCount") ?? 1,
      n8n_container_port:
        optionalNumber(desiredConfig, "containerPort") ?? 5678,
      n8n_queue_mode: true,
      n8n_task_runners_enabled:
        optionalBoolean(desiredConfig, "taskRunnersEnabled") ?? true,
      n8n_package_config_digest: packageConfigDigest,
      n8n_custom_package_specs: packageConfig.packageSpecs,
      n8n_cache_engine: optionalString(desiredConfig, "cacheEngine"),
      n8n_cache_engine_version: optionalString(
        desiredConfig,
        "cacheEngineVersion",
      ),
      n8n_cache_parameter_group_family: optionalString(
        desiredConfig,
        "cacheParameterGroupFamily",
      ),
      n8n_cache_node_type: optionalString(desiredConfig, "cacheNodeType"),
      n8n_cache_num_cache_clusters: optionalNumber(
        desiredConfig,
        "cacheNumCacheClusters",
      ),
      n8n_allowed_public_cidr_blocks: optionalStringArray(
        desiredConfig,
        "allowedPublicCidrBlocks",
      ),
      n8n_kms_key_arns: optionalStringArray(desiredConfig, "kmsKeyArns"),
    });
  },
  buildImageBuildPlan({ operation, desiredConfig, tenantId, releaseVersion }) {
    if (operation === "DESTROY") return undefined;
    const packageConfig = normalizeN8nPackageConfig(desiredConfig);
    const packageImageUri = optionalString(desiredConfig, "packageImageUri");
    if (packageConfig.packageSpecs.length === 0 && !packageImageUri) {
      return undefined;
    }
    if (!tenantId) {
      throw new Error(
        "tenantId is required to plan an n8n package image build",
      );
    }

    const baseImageUri = requireDigestImage(
      desiredConfig,
      "imageUri",
      "n8n imageUri",
    );
    const taskRunnersEnabled =
      optionalBoolean(desiredConfig, "taskRunnersEnabled") ?? true;
    const contract = buildN8nPackageImageBuildContract({
      tenantId,
      pluginVersion: releaseVersion ?? "0.0.0",
      baseImageUri,
      taskRunnersEnabled,
      customPackageSpecs: packageConfig.packageSpecs,
      packageConfigDigest: desiredConfig?.packageConfigDigest,
      packageImageUri: desiredConfig?.packageImageUri,
      packageImageConfigDigest: desiredConfig?.packageImageConfigDigest,
    });
    return n8nPackageImageBuildSummary(contract);
  },
  dataImpact(operation) {
    if (operation !== "DESTROY") {
      return {
        destructive: false,
        summary: "No destructive n8n teardown requested.",
        resources: [],
      };
    }
    return {
      destructive: true,
      summary:
        "n8n destroy deletes the n8n runtime and customer-owned workflow automation data.",
      resources: [
        "n8n main and worker ECS services, task definitions, task/execution IAM roles, and public ALB/listener/target-group resources",
        "Dedicated thinkwork_n8n database, least-privilege database role, database URL secret, admin setup grants, and encryption/operator/service credential secrets",
        "Dedicated ElastiCache Valkey/Redis replication group, subnet group, parameter group, and queue endpoint",
        "S3 bucket objects or dedicated prefixes containing n8n binary data, runtime files, and export/import staging artifacts",
        "CloudWatch log groups, wrapper image/package configuration evidence, and deployment evidence artifacts for n8n jobs",
      ],
    };
  },
  preDestroySteps(operation) {
    if (operation !== "DESTROY") return [];
    return [
      {
        id: "n8n-db-drop",
        description:
          "Drop the dedicated thinkwork_n8n database and least-privilege role after active sessions are terminated.",
        evidenceKey: "pre-destroy/n8n-db-drop.json",
      },
      {
        id: "n8n-storage-inventory",
        description:
          "Inventory n8n binary data and runtime-file objects before deleting or retaining the managed storage prefix.",
        evidenceKey: "pre-destroy/n8n-storage-inventory.json",
      },
      {
        id: "n8n-service-credential-cleanup",
        description:
          "Verify the tenant service credential secret and native MCP access token material are deleted or marked for deletion.",
        evidenceKey: "pre-destroy/n8n-service-credential-cleanup.json",
      },
      {
        id: "n8n-package-image-inventory",
        description:
          "Record the pinned package configuration digest and wrapper image digest before teardown.",
        evidenceKey: "pre-destroy/n8n-package-image-inventory.json",
      },
    ];
  },
  smokeContracts,
  statusOutputs: [...statusOutputs],
  extractStatus(terraformOutputs) {
    const provisioned = boolOutput(terraformOutputs, "n8n_provisioned");
    const runtimeEnabled = boolOutput(terraformOutputs, "n8n_runtime_enabled");
    const endpoint = stringOutput(terraformOutputs, "n8n_url");
    return {
      provisioned,
      runtimeEnabled,
      endpoint,
      status: !provisioned ? "disabled" : runtimeEnabled ? "running" : "parked",
      evidence: {
        endpoint,
        albArn: stringOutput(terraformOutputs, "n8n_alb_arn"),
        targetGroupArn: stringOutput(terraformOutputs, "n8n_target_group_arn"),
        clusterArn: stringOutput(terraformOutputs, "n8n_cluster_arn"),
        mainServiceName: stringOutput(
          terraformOutputs,
          "n8n_main_service_name",
        ),
        workerServiceName: stringOutput(
          terraformOutputs,
          "n8n_worker_service_name",
        ),
        mainLogGroupName: stringOutput(
          terraformOutputs,
          "n8n_main_log_group_name",
        ),
        workerLogGroupName: stringOutput(
          terraformOutputs,
          "n8n_worker_log_group_name",
        ),
        databaseName: stringOutput(terraformOutputs, "n8n_database_name"),
        databaseSecretArn: stringOutput(
          terraformOutputs,
          "n8n_database_secret_arn",
        ),
        valkeyEndpoint: stringOutput(terraformOutputs, "n8n_valkey_endpoint"),
        storageBucketName: stringOutput(
          terraformOutputs,
          "n8n_storage_bucket_name",
        ),
        storagePrefix: stringOutput(terraformOutputs, "n8n_storage_prefix"),
        imageDigest: stringOutput(terraformOutputs, "n8n_image_digest"),
        packageConfigDigest: stringOutput(
          terraformOutputs,
          "n8n_package_config_digest",
        ),
        serviceCredentialSecretArn: stringOutput(
          terraformOutputs,
          "n8n_service_credential_secret_arn",
        ),
      },
    };
  },
};

function optionalBoolean(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = desiredConfig?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null || entry === "") return false;
      if (Array.isArray(entry) && entry.length === 0) return false;
      return true;
    }),
  );
}
