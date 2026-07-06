/**
 * Pins the pnpm-patched @earendil-works/pi-ai Bedrock provider's per-model
 * region resolution (patches/@earendil-works__pi-ai@0.76.0.patch).
 *
 * The patch adds `PI_BEDROCK_MODEL_REGIONS` — a JSON map of model id →
 * region — consulted after `options.region` and before `AWS_REGION`, so a
 * single degraded regional marketplace endpoint (the 2026-07-06
 * moonshotai.kimi-k2.5 us-east-1 throughput collapse) can be routed around
 * without moving the whole runtime's region.
 *
 * The provider doesn't export its region resolver, so the suite extracts
 * `getConfiguredBedrockRegion` + its helper from the installed (patched)
 * module source and evaluates them in isolation. If a pi-ai upgrade drops
 * the patch or renames the function, the extraction fails loudly here —
 * exactly the signal we want before a silent regression to env-only
 * routing ships.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type RegionResolver = (
  options: { region?: string },
  model?: { id?: string },
) => string | undefined;

function loadPatchedRegionResolver(): RegionResolver {
  // pnpm symlinks the (patched) package into this workspace's node_modules;
  // resolve relative to the test file rather than through the ESM-only
  // exports map, which blocks require.resolve from CJS.
  const providerPath = fileURLToPath(
    new URL(
      "../node_modules/@earendil-works/pi-ai/dist/providers/amazon-bedrock.js",
      import.meta.url,
    ),
  );
  const source = readFileSync(providerPath, "utf8");

  const start = source.indexOf("let cachedBedrockModelRegionMap");
  const marker = "function getConfiguredBedrockRegion";
  const fnStart = source.indexOf(marker);
  if (start === -1 || fnStart === -1) {
    throw new Error(
      "patched pi-ai region resolver not found — did a pi-ai upgrade drop patches/@earendil-works__pi-ai@0.76.0.patch?",
    );
  }
  const fnEnd = source.indexOf("\n}", fnStart);
  const snippet = source.slice(start, fnEnd + 2);

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    `${snippet}\nreturn getConfiguredBedrockRegion;`,
  );
  return factory() as RegionResolver;
}

describe("patched pi-ai per-model Bedrock region override", () => {
  const savedRegion = process.env.AWS_REGION;
  const savedDefault = process.env.AWS_DEFAULT_REGION;
  const savedMap = process.env.PI_BEDROCK_MODEL_REGIONS;

  beforeEach(() => {
    process.env.AWS_REGION = "us-east-1";
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.PI_BEDROCK_MODEL_REGIONS;
  });

  afterEach(() => {
    if (savedRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = savedRegion;
    if (savedDefault === undefined) delete process.env.AWS_DEFAULT_REGION;
    else process.env.AWS_DEFAULT_REGION = savedDefault;
    if (savedMap === undefined) delete process.env.PI_BEDROCK_MODEL_REGIONS;
    else process.env.PI_BEDROCK_MODEL_REGIONS = savedMap;
  });

  it("routes a mapped model to its override region over AWS_REGION", () => {
    const resolve = loadPatchedRegionResolver();
    process.env.PI_BEDROCK_MODEL_REGIONS = JSON.stringify({
      "moonshotai.kimi-k2.5": "us-west-2",
    });
    expect(resolve({}, { id: "moonshotai.kimi-k2.5" })).toBe("us-west-2");
  });

  it("falls back to AWS_REGION for unmapped models", () => {
    const resolve = loadPatchedRegionResolver();
    process.env.PI_BEDROCK_MODEL_REGIONS = JSON.stringify({
      "moonshotai.kimi-k2.5": "us-west-2",
    });
    expect(
      resolve({}, { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0" }),
    ).toBe("us-east-1");
  });

  it("ignores malformed JSON and falls back to AWS_REGION", () => {
    const resolve = loadPatchedRegionResolver();
    process.env.PI_BEDROCK_MODEL_REGIONS = "{not json";
    expect(resolve({}, { id: "moonshotai.kimi-k2.5" })).toBe("us-east-1");
  });

  it("lets an explicit options.region win over the map", () => {
    const resolve = loadPatchedRegionResolver();
    process.env.PI_BEDROCK_MODEL_REGIONS = JSON.stringify({
      "moonshotai.kimi-k2.5": "us-west-2",
    });
    expect(
      resolve({ region: "eu-central-1" }, { id: "moonshotai.kimi-k2.5" }),
    ).toBe("eu-central-1");
  });

  it("treats an empty map and a missing model as no-override", () => {
    const resolve = loadPatchedRegionResolver();
    process.env.PI_BEDROCK_MODEL_REGIONS = "{}";
    expect(resolve({}, { id: "moonshotai.kimi-k2.5" })).toBe("us-east-1");
    expect(resolve({}, undefined)).toBe("us-east-1");
  });
});
