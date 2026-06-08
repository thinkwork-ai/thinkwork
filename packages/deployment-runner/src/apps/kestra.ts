import {
  type ManagedAppAdapter,
  type RequiredManagedAppInput,
} from "./registry.js";
import {
  boolOutput,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requireDigestImage,
  requireStringInput,
  stringOutput,
} from "./utils.js";

const smokeContracts = [
  {
    id: "kestra-health",
    command: "scripts/smoke/kestra-managed-app-smoke.mjs",
    required: true,
  },
] as const;

const statusOutputs = [
  "kestra_provisioned",
  "kestra_runtime_enabled",
  "kestra_url",
  "kestra_alb_arn",
  "kestra_target_group_arn",
  "kestra_cluster_arn",
  "kestra_service_name",
  "kestra_log_group_name",
  "kestra_storage_bucket_name",
  "kestra_storage_file_system_id",
  "kestra_database_name",
  "kestra_basic_auth_secret_arn",
] as const;

const provisionRequiredInputs: RequiredManagedAppInput[] = [
  {
    key: "imageUri",
    description: "Kestra container image URI pinned with @sha256.",
    terraformVariable: "kestra_image_uri",
  },
  {
    key: "dbPasswordSecretArn",
    description: "Secrets Manager ARN for the dedicated Kestra DB password.",
    terraformVariable: "kestra_db_password_secret_arn",
    secret: true,
  },
  {
    key: "basicAuthSecretArn",
    description:
      "Secrets Manager ARN containing the Kestra UI/API service credential.",
    terraformVariable: "kestra_basic_auth_secret_arn",
    secret: true,
  },
  {
    key: "publicUrl",
    description: "Public HTTPS origin for Kestra.",
    terraformVariable: "kestra_public_url",
  },
  {
    key: "certificateArn",
    description: "ACM certificate ARN for the public HTTPS listener.",
    terraformVariable: "kestra_certificate_arn",
  },
];

export const kestraAdapter: ManagedAppAdapter = {
  appKey: "kestra",
  displayName: "Kestra",
  description:
    "Customer-owned orchestration runtime with dedicated workflow state and storage.",
  terraformModulePath: "terraform/modules/app/kestra",
  requiredInputs(operation) {
    return operation === "DESTROY" ? [] : provisionRequiredInputs;
  },
  buildTerraformVariables({ operation, desiredConfig }) {
    if (operation === "DESTROY") {
      return {
        kestra_provisioned: false,
        kestra_runtime_enabled: false,
      };
    }

    const runtimeEnabled = operation !== "PARK";
    return compactObject({
      kestra_provisioned: true,
      kestra_runtime_enabled: runtimeEnabled,
      kestra_image_uri: requireDigestImage(
        desiredConfig,
        "imageUri",
        "Kestra imageUri",
      ),
      kestra_db_username: optionalString(desiredConfig, "dbUsername"),
      kestra_db_name: optionalString(desiredConfig, "dbName"),
      kestra_db_password_secret_arn: requireStringInput(
        desiredConfig,
        "dbPasswordSecretArn",
        "Kestra dbPasswordSecretArn",
      ),
      kestra_basic_auth_secret_arn: requireStringInput(
        desiredConfig,
        "basicAuthSecretArn",
        "Kestra basicAuthSecretArn",
      ),
      kestra_domain: optionalString(desiredConfig, "domain"),
      kestra_public_url: requireStringInput(
        desiredConfig,
        "publicUrl",
        "Kestra publicUrl",
      ),
      kestra_certificate_arn: requireStringInput(
        desiredConfig,
        "certificateArn",
        "Kestra certificateArn",
      ),
      kestra_desired_count: optionalNumber(desiredConfig, "desiredCount"),
      kestra_worker_task_count: optionalNumber(
        desiredConfig,
        "workerTaskCount",
      ),
      kestra_namespace_prefix: optionalString(desiredConfig, "namespacePrefix"),
      kestra_storage_bucket_name: optionalString(
        desiredConfig,
        "storageBucketName",
      ),
      kestra_allowed_public_cidr_blocks: optionalStringArray(
        desiredConfig,
        "allowedPublicCidrBlocks",
      ),
      kestra_kms_key_arns: optionalStringArray(desiredConfig, "kmsKeyArns"),
    });
  },
  dataImpact(operation) {
    if (operation !== "DESTROY") {
      return {
        destructive: false,
        summary: "No destructive Kestra teardown requested.",
        resources: [],
      };
    }
    return {
      destructive: true,
      summary:
        "Kestra destroy deletes the orchestration runtime, customer flow state, execution history, service credentials, and managed MCP registration.",
      resources: [
        "Kestra ECS service, task definition, task/execution IAM roles, and public ALB/listener/target-group resources",
        "Dedicated Kestra database, database role, DB password secret, flow definitions, execution history, and queue/repository state",
        "Kestra internal storage, namespace files, plugin/object state, and managed storage buckets or file systems",
        "Kestra UI/API basic-auth service credential and ThinkWork-owned Kestra control MCP bearer credential material",
        "System-managed Kestra MCP server row, runtime assignments, cached tool inventory, and repair evidence",
        "CloudWatch log groups and deployment evidence artifacts for the Kestra job",
      ],
    };
  },
  preDestroySteps(operation) {
    if (operation !== "DESTROY") return [];
    return [
      {
        id: "kestra-db-drop",
        description:
          "Drop the dedicated Kestra database and least-privilege role after active executions are stopped.",
        evidenceKey: "pre-destroy/kestra-db-drop.json",
      },
      {
        id: "kestra-storage-cleanup",
        description:
          "Verify Kestra internal storage and flow/execution artifacts are deleted or recorded for deletion.",
        evidenceKey: "pre-destroy/kestra-storage-cleanup.json",
      },
      {
        id: "kestra-managed-mcp-cleanup",
        description:
          "Verify the managed Kestra MCP row, assignments, and app-owned credential secrets are removed.",
        evidenceKey: "pre-destroy/kestra-managed-mcp-cleanup.json",
      },
    ];
  },
  smokeContracts,
  statusOutputs: [...statusOutputs],
  extractStatus(terraformOutputs) {
    const provisioned = boolOutput(terraformOutputs, "kestra_provisioned");
    const runtimeEnabled = boolOutput(
      terraformOutputs,
      "kestra_runtime_enabled",
    );
    const endpoint = stringOutput(terraformOutputs, "kestra_url");
    return {
      provisioned,
      runtimeEnabled,
      endpoint,
      status: !provisioned ? "disabled" : runtimeEnabled ? "running" : "parked",
      evidence: {
        endpoint,
        albArn: stringOutput(terraformOutputs, "kestra_alb_arn"),
        targetGroupArn: stringOutput(
          terraformOutputs,
          "kestra_target_group_arn",
        ),
        clusterArn: stringOutput(terraformOutputs, "kestra_cluster_arn"),
        serviceName: stringOutput(terraformOutputs, "kestra_service_name"),
        logGroupName: stringOutput(terraformOutputs, "kestra_log_group_name"),
        storageBucketName: stringOutput(
          terraformOutputs,
          "kestra_storage_bucket_name",
        ),
        storageFileSystemId: stringOutput(
          terraformOutputs,
          "kestra_storage_file_system_id",
        ),
        databaseName: stringOutput(terraformOutputs, "kestra_database_name"),
        basicAuthSecretArn: stringOutput(
          terraformOutputs,
          "kestra_basic_auth_secret_arn",
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
