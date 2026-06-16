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

const smokeContracts = [
  {
    id: "twenty-health",
    command: "plugins/twenty/smoke/twenty-managed-app-smoke.mjs",
    required: true,
  },
] as const;

const statusOutputs = [
  "twenty_provisioned",
  "twenty_runtime_enabled",
  "twenty_url",
  "twenty_alb_arn",
  "twenty_target_group_arn",
  "twenty_cluster_arn",
  "twenty_server_service_name",
  "twenty_worker_service_name",
  "twenty_server_log_group_name",
  "twenty_worker_log_group_name",
  "twenty_cache_endpoint",
  "twenty_storage_file_system_id",
] as const;

const provisionRequiredInputs: RequiredManagedAppInput[] = [
  {
    key: "imageUri",
    description: "Twenty CRM container image URI pinned with @sha256.",
    terraformVariable: "twenty_image_uri",
  },
  {
    key: "dbUrlSecretArn",
    description: "Secrets Manager ARN containing PG_DATABASE_URL.",
    terraformVariable: "twenty_db_url_secret_arn",
    secret: true,
  },
  {
    key: "encryptionKeySecretArn",
    description: "Secrets Manager ARN containing ENCRYPTION_KEY.",
    terraformVariable: "twenty_encryption_key_secret_arn",
    secret: true,
  },
  {
    key: "publicUrl",
    description: "Public HTTPS origin for Twenty CRM.",
    terraformVariable: "twenty_public_url",
  },
  {
    key: "certificateArn",
    description: "ACM certificate ARN for the public HTTPS listener.",
    terraformVariable: "twenty_certificate_arn",
  },
];

export const twentyAdapter: ManagedAppAdapter = {
  appKey: "twenty",
  displayName: "Twenty CRM",
  description: "Customer-owned CRM runtime with dedicated data and storage.",
  catalogVisible: true,
  terraformModulePath: "plugins/twenty/terraform/twenty",
  requiredInputs(operation) {
    return operation === "DESTROY" ? [] : provisionRequiredInputs;
  },
  buildTerraformVariables({ operation, desiredConfig }) {
    if (operation === "DESTROY") {
      return {
        twenty_provisioned: false,
        twenty_runtime_enabled: false,
      };
    }

    const runtimeEnabled = operation !== "PARK";
    return compactObject({
      twenty_provisioned: true,
      twenty_runtime_enabled: runtimeEnabled,
      twenty_image_uri: requireDigestImage(
        desiredConfig,
        "imageUri",
        "Twenty imageUri",
      ),
      twenty_db_username: optionalString(desiredConfig, "dbUsername"),
      twenty_db_name: optionalString(desiredConfig, "dbName"),
      twenty_db_url_secret_arn: requireStringInput(
        desiredConfig,
        "dbUrlSecretArn",
        "Twenty dbUrlSecretArn",
      ),
      twenty_encryption_key_secret_arn: requireStringInput(
        desiredConfig,
        "encryptionKeySecretArn",
        "Twenty encryptionKeySecretArn",
      ),
      twenty_email_from_address: optionalString(
        desiredConfig,
        "emailFromAddress",
      ),
      twenty_email_from_name: optionalString(desiredConfig, "emailFromName"),
      twenty_email_smtp_host: optionalString(desiredConfig, "emailSmtpHost"),
      twenty_fallback_encryption_key_secret_arn: optionalString(
        desiredConfig,
        "fallbackEncryptionKeySecretArn",
      ),
      twenty_app_secret_arn: optionalString(desiredConfig, "appSecretArn"),
      twenty_domain: optionalString(desiredConfig, "domain"),
      twenty_public_url: requireStringInput(
        desiredConfig,
        "publicUrl",
        "Twenty publicUrl",
      ),
      twenty_certificate_arn: requireStringInput(
        desiredConfig,
        "certificateArn",
        "Twenty certificateArn",
      ),
      twenty_server_desired_count: optionalNumber(
        desiredConfig,
        "serverDesiredCount",
      ),
      twenty_worker_desired_count: optionalNumber(
        desiredConfig,
        "workerDesiredCount",
      ),
      twenty_cache_engine: optionalString(desiredConfig, "cacheEngine"),
      twenty_cache_engine_version: optionalString(
        desiredConfig,
        "cacheEngineVersion",
      ),
      twenty_cache_parameter_group_family: optionalString(
        desiredConfig,
        "cacheParameterGroupFamily",
      ),
      twenty_cache_node_type: optionalString(desiredConfig, "cacheNodeType"),
      twenty_cache_num_cache_clusters: optionalNumber(
        desiredConfig,
        "cacheNumCacheClusters",
      ),
      twenty_allowed_public_cidr_blocks: optionalStringArray(
        desiredConfig,
        "allowedPublicCidrBlocks",
      ),
      twenty_kms_key_arns: optionalStringArray(desiredConfig, "kmsKeyArns"),
    });
  },
  dataImpact(operation) {
    if (operation !== "DESTROY") {
      return {
        destructive: false,
        summary: "No destructive Twenty CRM teardown requested.",
        resources: [],
      };
    }
    return {
      destructive: true,
      summary:
        "Twenty CRM destroy deletes CRM runtime resources and customer CRM data owned by the managed app.",
      resources: [
        "Twenty server and worker ECS services, task definitions, task/execution IAM roles, and public ALB/listener/target-group resources",
        "Dedicated Twenty database, database role, DB URL secret, encryption key secret, fallback key secret, and app secret",
        "Encrypted EFS file system, access point, mount targets, and local file storage",
        "ElastiCache Valkey/Redis replication group, subnet group, parameter group, and cache endpoint",
        "CloudWatch log groups and deployment evidence artifacts for the Twenty job",
      ],
    };
  },
  preDestroySteps(operation) {
    if (operation !== "DESTROY") return [];
    return [
      {
        id: "twenty-db-drop",
        description:
          "Drop the dedicated Twenty database and least-privilege role after active sessions are terminated.",
        evidenceKey: "pre-destroy/twenty-db-drop.json",
      },
      {
        id: "twenty-secret-cleanup",
        description:
          "Verify Terraform-owned Twenty secrets are deleted or marked for deletion with recovery windows recorded.",
        evidenceKey: "pre-destroy/twenty-secret-cleanup.json",
      },
    ];
  },
  smokeContracts,
  statusOutputs: [...statusOutputs],
  extractStatus(terraformOutputs) {
    const provisioned = boolOutput(terraformOutputs, "twenty_provisioned");
    const runtimeEnabled = boolOutput(
      terraformOutputs,
      "twenty_runtime_enabled",
    );
    const endpoint = stringOutput(terraformOutputs, "twenty_url");
    return {
      provisioned,
      runtimeEnabled,
      endpoint,
      status: !provisioned ? "disabled" : runtimeEnabled ? "running" : "parked",
      evidence: {
        endpoint,
        albArn: stringOutput(terraformOutputs, "twenty_alb_arn"),
        targetGroupArn: stringOutput(
          terraformOutputs,
          "twenty_target_group_arn",
        ),
        clusterArn: stringOutput(terraformOutputs, "twenty_cluster_arn"),
        serverServiceName: stringOutput(
          terraformOutputs,
          "twenty_server_service_name",
        ),
        workerServiceName: stringOutput(
          terraformOutputs,
          "twenty_worker_service_name",
        ),
        serverLogGroupName: stringOutput(
          terraformOutputs,
          "twenty_server_log_group_name",
        ),
        workerLogGroupName: stringOutput(
          terraformOutputs,
          "twenty_worker_log_group_name",
        ),
        cacheEndpoint: stringOutput(terraformOutputs, "twenty_cache_endpoint"),
        storageFileSystemId: stringOutput(
          terraformOutputs,
          "twenty_storage_file_system_id",
        ),
      },
    };
  },
};

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
