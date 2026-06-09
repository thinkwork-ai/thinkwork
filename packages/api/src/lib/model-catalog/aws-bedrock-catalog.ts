import {
  BedrockClient,
  ListFoundationModelsCommand,
  type FoundationModelSummary,
} from "@aws-sdk/client-bedrock";

export type BedrockCatalogModel = {
  provider: "bedrock";
  providerName: string;
  modelName: string;
  modelId: string;
  inputModalities: string[];
  outputModalities: string[];
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  customizationsSupported: string[];
  inferenceTypesSupported: string[];
  lifecycleStatus: string | null;
  raw: FoundationModelSummary;
};

export function toBedrockCatalogModel(
  summary: FoundationModelSummary,
): BedrockCatalogModel | null {
  if (!summary.modelId) return null;

  const inputModalities = summary.inputModalities ?? [];
  const outputModalities = summary.outputModalities ?? [];

  return {
    provider: "bedrock",
    providerName: summary.providerName ?? "Bedrock",
    modelName: summary.modelName ?? summary.modelId,
    modelId: summary.modelId,
    inputModalities,
    outputModalities,
    supportsStreaming: summary.responseStreamingSupported ?? false,
    supportsVision: inputModalities.some(
      (modality) => modality.toLowerCase() === "image",
    ),
    supportsTools: outputModalities.some(
      (modality) => modality.toLowerCase() === "text",
    ),
    customizationsSupported: summary.customizationsSupported ?? [],
    inferenceTypesSupported: summary.inferenceTypesSupported ?? [],
    lifecycleStatus: summary.modelLifecycle?.status ?? null,
    raw: summary,
  };
}

export async function listBedrockCatalogModels(
  options: {
    client?: Pick<BedrockClient, "send">;
    region?: string;
  } = {},
): Promise<BedrockCatalogModel[]> {
  const client =
    options.client ??
    new BedrockClient({
      region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
    });
  const response = await client.send(new ListFoundationModelsCommand({}));
  return (response.modelSummaries ?? [])
    .map(toBedrockCatalogModel)
    .filter((model): model is BedrockCatalogModel => model !== null)
    .sort((a, b) =>
      `${a.providerName} ${a.modelName}`.localeCompare(
        `${b.providerName} ${b.modelName}`,
      ),
    );
}
