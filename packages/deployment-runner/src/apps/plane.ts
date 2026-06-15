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
    id: "plane-runtime-health",
    command: "plugins/plane/smoke/plane-managed-app-smoke.mjs",
    required: true,
  },
] as const;

const DEFAULT_PLANE_AIO_IMAGE_URI =
  "artifacts.plane.so/makeplane/plane-aio-commercial:stable@sha256:7385b873e58f8325e68950689ae003ce1cb8d017f49011ab4b3f1ad9e6e958db";

const statusOutputs = [
  "plane_provisioned",
  "plane_runtime_enabled",
  "plane_url",
  "plane_alb_arn",
  "plane_target_group_arn",
  "plane_cluster_arn",
  "plane_web_service_name",
  "plane_api_service_name",
  "plane_worker_service_name",
  "plane_beat_worker_service_name",
  "plane_live_service_name",
  "plane_mcp_service_name",
  "plane_web_log_group_name",
  "plane_api_log_group_name",
  "plane_worker_log_group_name",
  "plane_beat_worker_log_group_name",
  "plane_live_log_group_name",
  "plane_mcp_log_group_name",
  "plane_cache_endpoint",
  "plane_rabbitmq_broker_arn",
  "plane_storage_bucket_name",
] as const;

const provisionRequiredInputs: RequiredManagedAppInput[] = [
  {
    key: "imageUri",
    description: "Plane all-in-one image URI pinned with @sha256.",
    terraformVariable: "plane_image_uri",
  },
  {
    key: "mcpImageUri",
    description: "Plane MCP sidecar image URI pinned with @sha256.",
    terraformVariable: "plane_mcp_image_uri",
  },
  {
    key: "dbUrlSecretArn",
    description: "Secrets Manager ARN containing Plane DATABASE_URL.",
    terraformVariable: "plane_db_url_secret_arn",
    secret: true,
  },
  {
    key: "secretKeySecretArn",
    description: "Secrets Manager ARN containing Plane SECRET_KEY.",
    terraformVariable: "plane_secret_key_secret_arn",
    secret: true,
  },
  {
    key: "liveServerSecretKeySecretArn",
    description: "Secrets Manager ARN containing Plane LIVE_SERVER_SECRET_KEY.",
    terraformVariable: "plane_live_server_secret_key_secret_arn",
    secret: true,
  },
  {
    key: "aesSecretKeySecretArn",
    description: "Secrets Manager ARN containing Plane AES_SECRET_KEY.",
    terraformVariable: "plane_aes_secret_key_secret_arn",
    secret: true,
  },
  {
    key: "amqpUrlSecretArn",
    description: "Secrets Manager ARN containing Plane AMQP_URL.",
    terraformVariable: "plane_amqp_url_secret_arn",
    secret: true,
  },
  {
    key: "s3AccessKeyIdSecretArn",
    description:
      "Optional Secrets Manager ARN containing an access key id for Plane S3 uploads. ECS task-role access is used when omitted.",
    terraformVariable: "plane_s3_access_key_id_secret_arn",
    secret: true,
  },
  {
    key: "s3SecretAccessKeySecretArn",
    description:
      "Optional Secrets Manager ARN containing a secret access key for Plane S3 uploads. ECS task-role access is used when omitted.",
    terraformVariable: "plane_s3_secret_access_key_secret_arn",
    secret: true,
  },
  {
    key: "s3BucketName",
    description: "S3 bucket name used for Plane file uploads.",
    terraformVariable: "plane_s3_bucket_name",
  },
  {
    key: "publicUrl",
    description: "Public HTTPS origin for Plane.",
    terraformVariable: "plane_public_url",
  },
  {
    key: "certificateArn",
    description: "ACM certificate ARN for the Plane public HTTPS listener.",
    terraformVariable: "plane_certificate_arn",
  },
];

export const planeAdapter: ManagedAppAdapter = {
  appKey: "plane",
  displayName: "Plane",
  description:
    "Customer-owned Plane project management runtime with retained work-item data and user-scoped agent integration.",
  catalogVisible: false,
  terraformModulePath: "terraform/modules/app/plane",
  requiredInputs(operation) {
    return operation === "DESTROY" ? [] : provisionRequiredInputs;
  },
  buildTerraformVariables({ operation, desiredConfig }) {
    if (operation === "DESTROY") {
      return {
        plane_provisioned: false,
        plane_runtime_enabled: false,
      };
    }

    const runtimeEnabled = operation !== "PARK";
    return compactObject({
      plane_provisioned: true,
      plane_runtime_enabled: runtimeEnabled,
      plane_image_uri:
        optionalString(desiredConfig, "imageUri") !== undefined
          ? requireDigestImage(desiredConfig, "imageUri", "Plane imageUri")
          : DEFAULT_PLANE_AIO_IMAGE_URI,
      plane_mcp_image_uri: requireDigestImage(
        desiredConfig,
        "mcpImageUri",
        "Plane mcpImageUri",
      ),
      plane_db_url_secret_arn: requireStringInput(
        desiredConfig,
        "dbUrlSecretArn",
        "Plane dbUrlSecretArn",
      ),
      plane_secret_key_secret_arn: requireStringInput(
        desiredConfig,
        "secretKeySecretArn",
        "Plane secretKeySecretArn",
      ),
      plane_live_server_secret_key_secret_arn: requireStringInput(
        desiredConfig,
        "liveServerSecretKeySecretArn",
        "Plane liveServerSecretKeySecretArn",
      ),
      plane_aes_secret_key_secret_arn: requireStringInput(
        desiredConfig,
        "aesSecretKeySecretArn",
        "Plane aesSecretKeySecretArn",
      ),
      plane_amqp_url_secret_arn: requireStringInput(
        desiredConfig,
        "amqpUrlSecretArn",
        "Plane amqpUrlSecretArn",
      ),
      plane_s3_access_key_id_secret_arn: optionalString(
        desiredConfig,
        "s3AccessKeyIdSecretArn",
      ),
      plane_s3_secret_access_key_secret_arn: optionalString(
        desiredConfig,
        "s3SecretAccessKeySecretArn",
      ),
      plane_s3_bucket_name: requireStringInput(
        desiredConfig,
        "s3BucketName",
        "Plane s3BucketName",
      ),
      plane_public_url: requireStringInput(
        desiredConfig,
        "publicUrl",
        "Plane publicUrl",
      ),
      plane_certificate_arn: requireStringInput(
        desiredConfig,
        "certificateArn",
        "Plane certificateArn",
      ),
      plane_domain: optionalString(desiredConfig, "domain"),
      plane_web_desired_count:
        optionalNumber(desiredConfig, "appDesiredCount") ??
        optionalNumber(desiredConfig, "webDesiredCount"),
      plane_cache_engine: optionalString(desiredConfig, "cacheEngine"),
      plane_cache_engine_version: optionalString(
        desiredConfig,
        "cacheEngineVersion",
      ),
      plane_cache_parameter_group_family: optionalString(
        desiredConfig,
        "cacheParameterGroupFamily",
      ),
      plane_cache_node_type: optionalString(desiredConfig, "cacheNodeType"),
      plane_cache_num_cache_clusters: optionalNumber(
        desiredConfig,
        "cacheNumCacheClusters",
      ),
      plane_allowed_public_cidr_blocks: optionalStringArray(
        desiredConfig,
        "allowedPublicCidrBlocks",
      ),
      plane_kms_key_arns: optionalStringArray(desiredConfig, "kmsKeyArns"),
    });
  },
  dataImpact(operation) {
    if (operation !== "DESTROY") {
      return {
        destructive: false,
        summary: "No destructive Plane teardown requested.",
        resources: [],
      };
    }
    return {
      destructive: true,
      summary:
        "Plane destroy deletes the Plane runtime and customer-owned Plane project management data.",
      resources: [
        "Plane ECS services, task definitions, task/execution IAM roles, and public ALB/listener/target-group resources",
        "Dedicated Plane database, database role, database URL secret, application secrets, and encryption secrets",
        "ElastiCache Valkey/Redis replication group, subnet group, parameter group, and cache endpoint",
        "Amazon MQ RabbitMQ broker, virtual host/user secrets, and queue state",
        "S3 bucket objects or dedicated prefixes containing Plane file uploads and attachments",
        "CloudWatch log groups and deployment evidence artifacts for Plane jobs",
      ],
    };
  },
  preDestroySteps(operation) {
    if (operation !== "DESTROY") return [];
    return [
      {
        id: "plane-db-drop",
        description:
          "Drop the dedicated Plane database and least-privilege role after active sessions are terminated.",
        evidenceKey: "pre-destroy/plane-db-drop.json",
      },
      {
        id: "plane-object-storage-inventory",
        description:
          "Inventory Plane file uploads and confirm whether retained S3 objects or prefixes should be deleted.",
        evidenceKey: "pre-destroy/plane-object-storage-inventory.json",
      },
      {
        id: "plane-secret-cleanup",
        description:
          "Verify Terraform-owned Plane secrets are deleted or marked for deletion with recovery windows recorded.",
        evidenceKey: "pre-destroy/plane-secret-cleanup.json",
      },
    ];
  },
  smokeContracts,
  statusOutputs: [...statusOutputs],
  extractStatus(terraformOutputs) {
    const provisioned = boolOutput(terraformOutputs, "plane_provisioned");
    const runtimeEnabled = boolOutput(
      terraformOutputs,
      "plane_runtime_enabled",
    );
    const endpoint = stringOutput(terraformOutputs, "plane_url");
    return {
      provisioned,
      runtimeEnabled,
      endpoint,
      status: !provisioned ? "disabled" : runtimeEnabled ? "running" : "parked",
      evidence: {
        endpoint,
        albArn: stringOutput(terraformOutputs, "plane_alb_arn"),
        targetGroupArn: stringOutput(
          terraformOutputs,
          "plane_target_group_arn",
        ),
        clusterArn: stringOutput(terraformOutputs, "plane_cluster_arn"),
        webServiceName: stringOutput(
          terraformOutputs,
          "plane_web_service_name",
        ),
        apiServiceName: stringOutput(
          terraformOutputs,
          "plane_api_service_name",
        ),
        workerServiceName: stringOutput(
          terraformOutputs,
          "plane_worker_service_name",
        ),
        beatWorkerServiceName: stringOutput(
          terraformOutputs,
          "plane_beat_worker_service_name",
        ),
        liveServiceName: stringOutput(
          terraformOutputs,
          "plane_live_service_name",
        ),
        mcpServiceName: stringOutput(
          terraformOutputs,
          "plane_mcp_service_name",
        ),
        webLogGroupName: stringOutput(
          terraformOutputs,
          "plane_web_log_group_name",
        ),
        apiLogGroupName: stringOutput(
          terraformOutputs,
          "plane_api_log_group_name",
        ),
        workerLogGroupName: stringOutput(
          terraformOutputs,
          "plane_worker_log_group_name",
        ),
        beatWorkerLogGroupName: stringOutput(
          terraformOutputs,
          "plane_beat_worker_log_group_name",
        ),
        liveLogGroupName: stringOutput(
          terraformOutputs,
          "plane_live_log_group_name",
        ),
        mcpLogGroupName: stringOutput(
          terraformOutputs,
          "plane_mcp_log_group_name",
        ),
        cacheEndpoint: stringOutput(terraformOutputs, "plane_cache_endpoint"),
        rabbitmqBrokerArn: stringOutput(
          terraformOutputs,
          "plane_rabbitmq_broker_arn",
        ),
        storageBucketName: stringOutput(
          terraformOutputs,
          "plane_storage_bucket_name",
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
