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
    id: "cognee-health",
    command: "scripts/smoke/cognee-managed-app-smoke.mjs",
    required: true,
  },
] as const;

const statusOutputs = [
  "cognee_enabled",
  "cognee_endpoint",
  "cognee_log_group_name",
  "cognee_cluster_arn",
  "cognee_service_name",
  "cognee_storage_file_system_id",
] as const;

const enableRequiredInputs: RequiredManagedAppInput[] = [
  {
    key: "imageUri",
    description: "Cognee container image URI pinned with @sha256.",
    terraformVariable: "cognee_image_uri",
  },
  {
    key: "dbPasswordSecretArn",
    description: "Secrets Manager ARN for the dedicated Cognee DB password.",
    terraformVariable: "cognee_db_password_secret_arn",
    secret: true,
  },
  {
    key: "bedrockModelResourceArns",
    description:
      "Explicit Bedrock model or inference-profile ARNs for Cognee providers.",
    terraformVariable: "cognee_bedrock_model_resource_arns",
  },
];

export const cogneeAdapter: ManagedAppAdapter = {
  appKey: "cognee",
  displayName: "Cognee",
  description: "Knowledge graph runtime with app-owned graph/vector storage.",
  terraformModulePath: "terraform/modules/app/cognee",
  requiredInputs(operation) {
    return operation === "ENABLE" || operation === "UPGRADE"
      ? enableRequiredInputs
      : [];
  },
  buildTerraformVariables({ operation, desiredConfig }) {
    if (operation === "DESTROY" || operation === "PARK") {
      return {
        enable_cognee: false,
      };
    }

    const llmProvider =
      optionalString(desiredConfig, "llmProvider") ?? "bedrock";
    const embeddingProvider =
      optionalString(desiredConfig, "embeddingProvider") ?? "bedrock";
    const bedrockModelResourceArns = optionalStringArray(
      desiredConfig,
      "bedrockModelResourceArns",
    );

    if (
      (llmProvider === "bedrock" || embeddingProvider === "bedrock") &&
      !bedrockModelResourceArns
    ) {
      throw new Error(
        "Cognee Bedrock providers require bedrockModelResourceArns",
      );
    }

    return compactObject({
      enable_cognee: true,
      cognee_image_uri: requireDigestImage(
        desiredConfig,
        "imageUri",
        "Cognee imageUri",
      ),
      cognee_db_password_secret_arn: requireStringInput(
        desiredConfig,
        "dbPasswordSecretArn",
        "Cognee dbPasswordSecretArn",
      ),
      cognee_db_username: optionalString(desiredConfig, "dbUsername"),
      cognee_db_name: optionalString(desiredConfig, "dbName"),
      cognee_allowed_internal_cidr_blocks: optionalStringArray(
        desiredConfig,
        "allowedInternalCidrBlocks",
      ),
      cognee_allowed_internal_security_group_ids: optionalStringArray(
        desiredConfig,
        "allowedInternalSecurityGroupIds",
      ),
      cognee_backend_mode: optionalString(desiredConfig, "backendMode"),
      cognee_desired_count: optionalNumber(desiredConfig, "desiredCount"),
      cognee_llm_provider: llmProvider,
      cognee_llm_model: optionalString(desiredConfig, "llmModel"),
      cognee_llm_api_key_secret_arn: optionalString(
        desiredConfig,
        "llmApiKeySecretArn",
      ),
      cognee_embedding_provider: embeddingProvider,
      cognee_embedding_model: optionalString(desiredConfig, "embeddingModel"),
      cognee_embedding_dimensions: optionalNumber(
        desiredConfig,
        "embeddingDimensions",
      ),
      cognee_embedding_api_key_secret_arn: optionalString(
        desiredConfig,
        "embeddingApiKeySecretArn",
      ),
      cognee_vector_db_provider: optionalString(
        desiredConfig,
        "vectorDbProvider",
      ),
      cognee_vector_db_url: optionalString(desiredConfig, "vectorDbUrl"),
      cognee_vector_db_key_secret_arn: optionalString(
        desiredConfig,
        "vectorDbKeySecretArn",
      ),
      cognee_graph_database_provider: optionalString(
        desiredConfig,
        "graphDatabaseProvider",
      ),
      cognee_graph_database_url: optionalString(
        desiredConfig,
        "graphDatabaseUrl",
      ),
      cognee_graph_database_username: optionalString(
        desiredConfig,
        "graphDatabaseUsername",
      ),
      cognee_graph_database_password_secret_arn: optionalString(
        desiredConfig,
        "graphDatabasePasswordSecretArn",
      ),
      cognee_bedrock_model_resource_arns: bedrockModelResourceArns,
      cognee_kms_key_arns: optionalStringArray(desiredConfig, "kmsKeyArns"),
    });
  },
  dataImpact(operation) {
    if (operation !== "DESTROY") {
      return {
        destructive: false,
        summary: "No destructive Cognee teardown requested.",
        resources: [],
      };
    }
    return {
      destructive: true,
      summary:
        "Cognee destroy deletes the knowledge graph runtime and app-owned graph/vector data.",
      resources: [
        "Cognee ECS cluster, task definition, service, task/execution IAM roles, and internal ALB resources",
        "Encrypted EFS file system, access point, mount targets, graph/vector data, and system scratch directories",
        "Dedicated Cognee database, least-privilege database role, and password secret",
        "Provider and graph/vector database secrets owned by the Cognee module",
        "CloudWatch log groups and deployment evidence artifacts for the Cognee job",
      ],
    };
  },
  preDestroySteps(operation) {
    if (operation !== "DESTROY") return [];
    return [
      {
        id: "cognee-db-drop",
        description:
          "Drop the dedicated Cognee database and least-privilege role after active sessions are terminated.",
        evidenceKey: "pre-destroy/cognee-db-drop.json",
      },
    ];
  },
  smokeContracts,
  statusOutputs: [...statusOutputs],
  extractStatus(terraformOutputs) {
    const provisioned = boolOutput(terraformOutputs, "cognee_enabled");
    const endpoint = stringOutput(terraformOutputs, "cognee_endpoint");
    return {
      provisioned,
      runtimeEnabled: provisioned,
      endpoint,
      status: provisioned ? "running" : "disabled",
      evidence: {
        endpoint,
        logGroupName: stringOutput(terraformOutputs, "cognee_log_group_name"),
        clusterArn: stringOutput(terraformOutputs, "cognee_cluster_arn"),
        serviceName: stringOutput(terraformOutputs, "cognee_service_name"),
        storageFileSystemId: stringOutput(
          terraformOutputs,
          "cognee_storage_file_system_id",
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
