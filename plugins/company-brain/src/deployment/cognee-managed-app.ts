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

const BRAIN_STORAGE_TIERS = ["default", "production"] as const;

const smokeContracts = [
  {
    id: "cognee-health",
    command: "plugins/company-brain/smoke/cognee-managed-app-smoke.mjs",
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
  "cognee_brain_instance_key",
  "cognee_brain_tenant_id",
  "cognee_brain_storage_tier",
  "cognee_graph_database_provider",
  "cognee_vector_db_provider",
  "cognee_embedding_model",
  "cognee_embedding_dimensions",
  "cognee_s3_artifact_root",
  "cognee_s3_manifest_root",
  "cognee_s3_vault_projection_root",
  "cognee_neptune_graph_id",
  "cognee_neptune_endpoint",
  "cognee_private_substrate_mode",
  "cognee_production_posture",
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
  catalogVisible: true,
  terraformModulePath: "plugins/company-brain/terraform/cognee",
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

    const brainStorageTier = normalizeBrainStorageTier(desiredConfig);
    const llmProvider =
      optionalString(desiredConfig, "llmProvider") ?? "bedrock";
    const embeddingProvider =
      optionalString(desiredConfig, "embeddingProvider") ?? "bedrock";
    const backendMode =
      optionalString(desiredConfig, "backendMode") ??
      (brainStorageTier === "production" ? "remote" : "dogfood");
    const vectorDbProvider =
      optionalString(desiredConfig, "vectorDbProvider") ??
      (brainStorageTier === "production" ? "neptune_analytics" : "lancedb");
    const graphDatabaseProvider =
      optionalString(desiredConfig, "graphDatabaseProvider") ??
      (brainStorageTier === "production" ? "neptune_analytics" : "kuzu");
    const neptuneEndpoint = optionalString(desiredConfig, "neptuneEndpoint");
    const vectorDbUrl =
      optionalString(desiredConfig, "vectorDbUrl") ??
      (brainStorageTier === "production" ? neptuneEndpoint : undefined);
    const graphDatabaseUrl =
      optionalString(desiredConfig, "graphDatabaseUrl") ??
      (brainStorageTier === "production" ? neptuneEndpoint : undefined);
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
      cognee_backend_mode: backendMode,
      cognee_desired_count: optionalNumber(desiredConfig, "desiredCount"),
      cognee_brain_tenant_id: optionalString(desiredConfig, "brainTenantId"),
      cognee_brain_instance_key: optionalString(
        desiredConfig,
        "brainInstanceKey",
      ),
      cognee_brain_storage_tier: brainStorageTier,
      cognee_brain_s3_artifact_root: optionalString(
        desiredConfig,
        "brainS3ArtifactRoot",
      ),
      cognee_brain_s3_manifest_root: optionalString(
        desiredConfig,
        "brainS3ManifestRoot",
      ),
      cognee_brain_s3_vault_projection_root: optionalString(
        desiredConfig,
        "brainS3VaultProjectionRoot",
      ),
      cognee_brain_artifacts_bucket_arn: optionalString(
        desiredConfig,
        "brainArtifactsBucketArn",
      ),
      cognee_brain_artifacts_prefixes: optionalStringArray(
        desiredConfig,
        "brainArtifactsPrefixes",
      ),
      cognee_private_substrate_mode:
        optionalBoolean(desiredConfig, "privateSubstrateMode") ?? true,
      cognee_require_authentication: optionalBoolean(
        desiredConfig,
        "requireAuthentication",
      ),
      cognee_enable_backend_access_control: optionalBoolean(
        desiredConfig,
        "enableBackendAccessControl",
      ),
      cognee_cors_allowed_origins: optionalString(
        desiredConfig,
        "corsAllowedOrigins",
      ),
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
      cognee_vector_db_provider: vectorDbProvider,
      cognee_vector_db_url: vectorDbUrl,
      cognee_vector_db_key_secret_arn: optionalString(
        desiredConfig,
        "vectorDbKeySecretArn",
      ),
      cognee_graph_database_provider: graphDatabaseProvider,
      cognee_graph_database_url: graphDatabaseUrl,
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
      cognee_neptune_graph_id: optionalString(desiredConfig, "neptuneGraphId"),
      cognee_neptune_graph_arn: optionalString(
        desiredConfig,
        "neptuneGraphArn",
      ),
      cognee_neptune_endpoint: neptuneEndpoint,
      cognee_production_posture: optionalString(
        desiredConfig,
        "productionPosture",
      ),
    });
  },
  dataImpact(operation) {
    if (operation !== "DESTROY") {
      return {
        destructive: false,
        summary:
          "No destructive Company Brain substrate teardown requested. Provisioning or upgrades may create tenant-scoped Brain runtime resources.",
        resources: [
          "Canonical Company Brain S3 artifacts, ingestion manifests, migration snapshots, vault projections, and exports remain the replay source of truth.",
          "Default tier uses Cognee Postgres metadata plus local LanceDB/Kuzu graph/vector stores on the task storage substrate.",
          "Production tier uses Cognee-supported Neptune Analytics graph/vector resources when selected.",
        ],
      };
    }
    return {
      destructive: true,
      summary:
        "Company Brain substrate destroy deletes the internal runtime and non-canonical graph/vector working stores.",
      resources: [
        "Tenant-scoped Brain ECS cluster, task definition, service, task/execution IAM roles, and internal ALB resources",
        "Encrypted EFS file system, access point, mount targets, default-tier LanceDB/Kuzu graph/vector data, and system scratch directories",
        "Dedicated Brain/Cognee Postgres metadata database, least-privilege database role, and password secret",
        "Production-tier Neptune Analytics graph/vector resources referenced by the instance configuration",
        "Provider and graph/vector database secrets owned by the Brain substrate module",
        "CloudWatch log groups and deployment evidence artifacts for the Brain substrate job",
        "Canonical Company Brain S3 artifacts/manifests are not destroyed by this module and must follow the artifact retention/deletion workflow.",
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
        brainInstanceKey: stringOutput(
          terraformOutputs,
          "cognee_brain_instance_key",
        ),
        brainTenantId: stringOutput(terraformOutputs, "cognee_brain_tenant_id"),
        storageTier: stringOutput(
          terraformOutputs,
          "cognee_brain_storage_tier",
        ),
        backendMode: stringOutput(terraformOutputs, "cognee_backend_mode"),
        graphProvider: stringOutput(
          terraformOutputs,
          "cognee_graph_database_provider",
        ),
        vectorProvider: stringOutput(
          terraformOutputs,
          "cognee_vector_db_provider",
        ),
        embeddingModel: stringOutput(
          terraformOutputs,
          "cognee_embedding_model",
        ),
        vectorDimension: numberOutput(
          terraformOutputs,
          "cognee_embedding_dimensions",
        ),
        s3ArtifactRoot: stringOutput(
          terraformOutputs,
          "cognee_s3_artifact_root",
        ),
        s3ManifestRoot: stringOutput(
          terraformOutputs,
          "cognee_s3_manifest_root",
        ),
        s3VaultProjectionRoot: stringOutput(
          terraformOutputs,
          "cognee_s3_vault_projection_root",
        ),
        neptuneGraphId: stringOutput(
          terraformOutputs,
          "cognee_neptune_graph_id",
        ),
        neptuneEndpoint: stringOutput(
          terraformOutputs,
          "cognee_neptune_endpoint",
        ),
        storageFileSystemId: stringOutput(
          terraformOutputs,
          "cognee_storage_file_system_id",
        ),
        privateSubstrateMode: boolOutput(
          terraformOutputs,
          "cognee_private_substrate_mode",
        ),
        productionPosture: stringOutput(
          terraformOutputs,
          "cognee_production_posture",
        ),
      },
    };
  },
};

function normalizeBrainStorageTier(
  desiredConfig: Record<string, unknown> | undefined,
): (typeof BRAIN_STORAGE_TIERS)[number] {
  const tier =
    optionalString(desiredConfig, "brainStorageTier") ??
    optionalString(desiredConfig, "storageTier") ??
    "default";
  if (
    !BRAIN_STORAGE_TIERS.includes(tier as (typeof BRAIN_STORAGE_TIERS)[number])
  ) {
    throw new Error("Cognee brainStorageTier must be default or production");
  }
  return tier as (typeof BRAIN_STORAGE_TIERS)[number];
}

function optionalBoolean(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = desiredConfig?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberOutput(
  terraformOutputs: Record<string, unknown>,
  key: string,
): number | null {
  const value = terraformOutputs[key];
  const outputValue =
    value && typeof value === "object" && "value" in value
      ? (value as { value?: unknown }).value
      : value;
  return typeof outputValue === "number" && Number.isFinite(outputValue)
    ? outputValue
    : null;
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
