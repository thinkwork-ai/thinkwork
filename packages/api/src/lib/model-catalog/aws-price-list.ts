import {
  GetProductsCommand,
  PricingClient,
  type PricingClient as AwsPricingClient,
} from "@aws-sdk/client-pricing";

export type PricingResolutionStatus =
  | "resolved"
  | "missing"
  | "ambiguous"
  | "error";

export type BedrockPricingResolution =
  | {
      status: "resolved";
      inputCostPerMillion: string;
      outputCostPerMillion: string;
      pricingSource: "aws-price-list";
      diagnostics: Record<string, unknown>;
    }
  | {
      status: Exclude<PricingResolutionStatus, "resolved">;
      inputCostPerMillion: null;
      outputCostPerMillion: null;
      pricingSource: "aws-price-list";
      diagnostics: Record<string, unknown>;
    };

export type BedrockPricingLookupInput = {
  modelId: string;
  modelName?: string | null;
  providerName?: string | null;
  regionCode?: string;
};

type PriceProduct = {
  product?: {
    sku?: string;
    attributes?: Record<string, string | undefined>;
  };
  terms?: {
    OnDemand?: Record<
      string,
      {
        priceDimensions?: Record<
          string,
          {
            description?: string;
            unit?: string;
            pricePerUnit?: { USD?: string };
          }
        >;
      }
    >;
  };
};

type TokenDimension = {
  sku: string;
  direction: "input" | "output";
  costPerMillion: number;
  description: string;
};

const BEDROCK_PRICE_SERVICE_CODE = "AmazonBedrockFoundationModels";
const DEFAULT_PRICING_REGION = "us-east-1";

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parsePriceListEntry(value: string): PriceProduct | null {
  try {
    return JSON.parse(value) as PriceProduct;
  } catch {
    return null;
  }
}

function productMatchesModel(
  product: PriceProduct,
  input: BedrockPricingLookupInput,
): boolean {
  const attributes = product.product?.attributes ?? {};
  const values = Object.values(attributes)
    .filter((value): value is string => typeof value === "string")
    .map(normalize);
  const modelId = normalize(input.modelId);
  const modelName = normalize(input.modelName);

  if (values.some((value) => value === modelId || value.includes(modelId))) {
    return true;
  }

  if (
    modelName &&
    values.some((value) => value === modelName || value.includes(modelName))
  ) {
    return true;
  }

  const provider = normalize(input.providerName);
  if (provider && values.some((value) => value.includes(provider))) {
    const modelParts = input.modelId.split(".").filter(Boolean);
    return modelParts.some((part) =>
      values.some((value) => value.includes(part)),
    );
  }

  return false;
}

function unitMultiplier(unit: string, description: string): number | null {
  const text = `${unit} ${description}`.toLowerCase();
  if (text.match(/\b1[,\s]?000\b/) || text.includes("1k")) return 1_000;
  if (text.includes("million")) return 1;
  if (text.includes("token")) return 1_000_000;
  return null;
}

function classifyDirection(text: string): "input" | "output" | null {
  const lower = text.toLowerCase();
  if (lower.includes("input") || lower.includes("prompt")) return "input";
  if (lower.includes("output") || lower.includes("completion")) return "output";
  return null;
}

function tokenDimensionsForProduct(product: PriceProduct): TokenDimension[] {
  const sku = product.product?.sku ?? "unknown";
  const terms = Object.values(product.terms?.OnDemand ?? {});
  const dimensions = terms.flatMap((term) =>
    Object.values(term.priceDimensions ?? {}),
  );

  return dimensions.flatMap((dimension) => {
    const description = dimension.description ?? "";
    const unit = dimension.unit ?? "";
    const usd = Number(dimension.pricePerUnit?.USD);
    const direction = classifyDirection(`${description} ${unit}`);
    const multiplier = unitMultiplier(unit, description);
    if (!direction || !Number.isFinite(usd) || !multiplier) return [];
    return [
      {
        sku,
        direction,
        costPerMillion: usd * multiplier,
        description,
      },
    ];
  });
}

function distinct(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => Number(value.toFixed(8)))));
}

function formatCost(value: number): string {
  return value.toFixed(4);
}

export function resolveBedrockPricingFromPriceList(
  priceList: readonly string[],
  input: BedrockPricingLookupInput,
): BedrockPricingResolution {
  const products = priceList
    .map(parsePriceListEntry)
    .filter((product): product is PriceProduct => product !== null)
    .filter((product) => productMatchesModel(product, input));

  if (products.length === 0) {
    return {
      status: "missing",
      inputCostPerMillion: null,
      outputCostPerMillion: null,
      pricingSource: "aws-price-list",
      diagnostics: {
        reason: "no_matching_price_list_products",
        modelId: input.modelId,
      },
    };
  }

  const dimensions = products.flatMap(tokenDimensionsForProduct);
  const inputPrices = distinct(
    dimensions
      .filter((dimension) => dimension.direction === "input")
      .map((dimension) => dimension.costPerMillion),
  );
  const outputPrices = distinct(
    dimensions
      .filter((dimension) => dimension.direction === "output")
      .map((dimension) => dimension.costPerMillion),
  );

  if (inputPrices.length !== 1 || outputPrices.length !== 1) {
    return {
      status:
        inputPrices.length === 0 || outputPrices.length === 0
          ? "missing"
          : "ambiguous",
      inputCostPerMillion: null,
      outputCostPerMillion: null,
      pricingSource: "aws-price-list",
      diagnostics: {
        reason: "token_price_resolution_not_unique",
        modelId: input.modelId,
        matchingSkus: products.map((product) => product.product?.sku),
        inputPrices,
        outputPrices,
      },
    };
  }

  return {
    status: "resolved",
    inputCostPerMillion: formatCost(inputPrices[0]),
    outputCostPerMillion: formatCost(outputPrices[0]),
    pricingSource: "aws-price-list",
    diagnostics: {
      modelId: input.modelId,
      matchingSkus: products.map((product) => product.product?.sku),
      dimensions: dimensions.map((dimension) => ({
        sku: dimension.sku,
        direction: dimension.direction,
        description: dimension.description,
        costPerMillion: dimension.costPerMillion,
      })),
    },
  };
}

export async function fetchBedrockPriceList(
  input: { regionCode?: string; client?: Pick<AwsPricingClient, "send"> } = {},
): Promise<string[]> {
  const client =
    input.client ??
    new PricingClient({
      region: process.env.AWS_PRICING_REGION ?? DEFAULT_PRICING_REGION,
    });

  const priceList: string[] = [];
  let nextToken: string | undefined;
  do {
    const response = await client.send(
      new GetProductsCommand({
        ServiceCode: BEDROCK_PRICE_SERVICE_CODE,
        Filters: [
          {
            Type: "TERM_MATCH",
            Field: "regionCode",
            Value: input.regionCode ?? process.env.AWS_REGION ?? "us-east-1",
          },
        ],
        NextToken: nextToken,
      }),
    );
    priceList.push(...(response.PriceList ?? []));
    nextToken = response.NextToken;
  } while (nextToken);

  return priceList;
}

export async function resolveBedrockTokenPricing(
  input: BedrockPricingLookupInput & {
    client?: Pick<AwsPricingClient, "send">;
  },
): Promise<BedrockPricingResolution> {
  try {
    const priceList = await fetchBedrockPriceList({
      regionCode: input.regionCode,
      client: input.client,
    });
    return resolveBedrockPricingFromPriceList(priceList, input);
  } catch (error) {
    return {
      status: "error",
      inputCostPerMillion: null,
      outputCostPerMillion: null,
      pricingSource: "aws-price-list",
      diagnostics: {
        reason: "price_list_request_failed",
        modelId: input.modelId,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
