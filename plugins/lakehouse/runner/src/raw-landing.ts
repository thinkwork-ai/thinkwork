import type { LakeHouseExtractContract } from "../../src/edge-integration";

export function buildRawLandingKey(input: {
  extract: LakeHouseExtractContract;
  bundleVersion: string;
  runId: string;
  extractedAt: string;
}): string {
  return input.extract.rawLanding.prefixTemplate
    .replaceAll("{stream}", input.extract.streamName)
    .replaceAll("{bundleVersion}", input.bundleVersion)
    .replaceAll("{runId}", input.runId)
    .replaceAll("{date}", input.extractedAt.slice(0, 10));
}
