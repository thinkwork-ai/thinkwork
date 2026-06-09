import { describe, expect, it } from "vitest";

import { resolveBedrockPricingFromPriceList } from "./aws-price-list.js";

function priceListProduct(input: {
  sku: string;
  model: string;
  provider?: string;
  inputUsd: string;
  outputUsd: string;
}) {
  return JSON.stringify({
    product: {
      sku: input.sku,
      attributes: {
        model: input.model,
        provider: input.provider ?? "Anthropic",
        regionCode: "us-east-1",
      },
    },
    terms: {
      OnDemand: {
        [`${input.sku}.term`]: {
          priceDimensions: {
            [`${input.sku}.input`]: {
              description: `${input.model} input tokens`,
              unit: "1K tokens",
              pricePerUnit: { USD: input.inputUsd },
            },
            [`${input.sku}.output`]: {
              description: `${input.model} output tokens`,
              unit: "1K tokens",
              pricePerUnit: { USD: input.outputUsd },
            },
          },
        },
      },
    },
  });
}

describe("AWS Bedrock Price List pricing resolver", () => {
  it("resolves a unique input/output token price to per-million costs", () => {
    const result = resolveBedrockPricingFromPriceList(
      [
        priceListProduct({
          sku: "sku-sonnet",
          model: "Claude Sonnet 4.6",
          inputUsd: "0.003",
          outputUsd: "0.015",
        }),
      ],
      {
        modelId: "us.anthropic.claude-sonnet-4-6",
        modelName: "Claude Sonnet 4.6",
        providerName: "Anthropic",
      },
    );

    expect(result).toMatchObject({
      status: "resolved",
      inputCostPerMillion: "3.0000",
      outputCostPerMillion: "15.0000",
      pricingSource: "aws-price-list",
    });
  });

  it("marks missing token dimensions as missing instead of guessing", () => {
    const result = resolveBedrockPricingFromPriceList(
      [
        JSON.stringify({
          product: {
            sku: "sku-nova",
            attributes: { model: "Nova Video", regionCode: "us-east-1" },
          },
          terms: { OnDemand: {} },
        }),
      ],
      { modelId: "amazon.nova-video", modelName: "Nova Video" },
    );

    expect(result).toMatchObject({
      status: "missing",
      inputCostPerMillion: null,
      outputCostPerMillion: null,
    });
  });

  it("marks conflicting token prices as ambiguous", () => {
    const result = resolveBedrockPricingFromPriceList(
      [
        priceListProduct({
          sku: "sku-a",
          model: "Claude Sonnet 4.6",
          inputUsd: "0.003",
          outputUsd: "0.015",
        }),
        priceListProduct({
          sku: "sku-b",
          model: "Claude Sonnet 4.6",
          inputUsd: "0.004",
          outputUsd: "0.016",
        }),
      ],
      {
        modelId: "us.anthropic.claude-sonnet-4-6",
        modelName: "Claude Sonnet 4.6",
      },
    );

    expect(result).toMatchObject({
      status: "ambiguous",
      inputCostPerMillion: null,
      outputCostPerMillion: null,
    });
    expect(result.diagnostics).toMatchObject({
      inputPrices: [3, 4],
      outputPrices: [15, 16],
    });
  });
});
