import { describe, expect, it, vi } from "vitest";

// extractUsage is pure; stub the db-touching module graph it imports.
vi.mock("@thinkwork/database-pg", () => ({ getDb: () => ({}) }));
vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: () => ({}),
  getAppsyncApiKey: async () => null,
}));

const { extractUsage } = await import("./cost-recording.js");

describe("extractUsage", () => {
  it("extracts all four token counts from pi-ai style keys", () => {
    const usage = extractUsage({
      usage: { input: 100, output: 20, cacheRead: 400, cacheWrite: 50 },
      model: "anthropic.claude-sonnet-4-6",
    });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(usage.cachedReadTokens).toBe(400);
    expect(usage.cachedWriteTokens).toBe(50);
    expect(usage.model).toBe("anthropic.claude-sonnet-4-6");
  });

  it("extracts Bedrock Converse style cache keys", () => {
    const usage = extractUsage({
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 30,
        cacheWriteInputTokens: 40,
      },
    });
    expect(usage.cachedReadTokens).toBe(30);
    expect(usage.cachedWriteTokens).toBe(40);
  });

  it("extracts snake_case finalize payload keys", () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cached_read_tokens: 3,
        cached_write_tokens: 4,
      },
    });
    expect(usage.cachedReadTokens).toBe(3);
    expect(usage.cachedWriteTokens).toBe(4);
  });

  it("defaults cache counts to zero when absent (older runtime payloads)", () => {
    const usage = extractUsage({ usage: { inputTokens: 7, outputTokens: 3 } });
    expect(usage.cachedReadTokens).toBe(0);
    expect(usage.cachedWriteTokens).toBe(0);
  });
});
