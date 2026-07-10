import { describe, expect, it } from "vitest";
import { transformMcpResultText } from "../src/mcp-result-transforms.js";

const TRANSFORM = {
  type: "scaled-integer-to-decimal" as const,
  sourceField: "amountMicros",
  targetField: "value",
  scale: 6,
  removeSource: true,
};

describe("transformMcpResultText", () => {
  it("recursively converts scaled integers to exact decimal strings", () => {
    const input = JSON.stringify({
      amount: { amountMicros: 1_500_000_000, currencyCode: "USD" },
      nested: [{ amountMicros: "1234567", currencyCode: "USD" }],
    });

    expect(JSON.parse(transformMcpResultText(input, [TRANSFORM]))).toEqual({
      amount: { value: "1500", currencyCode: "USD" },
      nested: [{ value: "1.234567", currencyCode: "USD" }],
    });
  });

  it("preserves raw text and invalid source values", () => {
    expect(transformMcpResultText("not json", [TRANSFORM])).toBe("not json");
    const invalid = JSON.stringify({ amountMicros: "not-an-integer" });
    expect(transformMcpResultText(invalid, [TRANSFORM])).toBe(invalid);
  });
});
