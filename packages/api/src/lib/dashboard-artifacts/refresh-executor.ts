import type { DashboardManifestV1 } from "./manifest.js";
import { writeDashboardManifestToS3 } from "./storage.js";

const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export interface DashboardRefreshExecutionInput {
  tenantId: string;
  manifestKey: string;
  manifest: DashboardManifestV1;
  now?: Date;
}

export interface DashboardRefreshExecutionResult {
  manifest: DashboardManifestV1;
  output: {
    refreshed: true;
    deterministic: true;
    artifactId: string;
    snapshotId: string;
    recipeId: string;
    recipeVersion: number;
    refreshedAt: string;
    nextAllowedAt: string;
    sourceCount: number;
    tableCount: number;
    chartCount: number;
    evidenceCount: number;
  };
}

export async function executeDashboardArtifactRefresh(
  input: DashboardRefreshExecutionInput,
): Promise<DashboardRefreshExecutionResult> {
  const refreshed = buildRefreshedDashboardManifest(input.manifest, input.now);

  await writeDashboardManifestToS3({
    tenantId: input.tenantId,
    key: input.manifestKey,
    manifest: refreshed.manifest,
  });

  return refreshed;
}

export function buildRefreshedDashboardManifest(
  manifest: DashboardManifestV1,
  now = new Date(),
): DashboardRefreshExecutionResult {
  const refreshedAt = now.toISOString();
  const nextAllowedAt = new Date(
    now.getTime() + REFRESH_COOLDOWN_MS,
  ).toISOString();
  const snapshotId = `refresh-${manifest.snapshot.artifactId}-${compactTimestamp(
    refreshedAt,
  )}`;

  const refreshedManifest: DashboardManifestV1 = {
    ...manifest,
    snapshot: {
      ...manifest.snapshot,
      id: snapshotId,
      generatedAt: refreshedAt,
    },
    sources: manifest.sources.map((source) => ({
      ...source,
      asOf: refreshedAt,
    })),
    evidence: manifest.evidence.map((item) => ({
      ...item,
      fetchedAt: refreshedAt,
    })),
    refresh: {
      ...manifest.refresh,
      lastRefreshAt: refreshedAt,
      nextAllowedAt,
    },
  };

  return {
    manifest: refreshedManifest,
    output: {
      refreshed: true,
      deterministic: true,
      artifactId: manifest.snapshot.artifactId,
      snapshotId,
      recipeId: manifest.recipe.id,
      recipeVersion: manifest.refresh.recipeVersion,
      refreshedAt,
      nextAllowedAt,
      sourceCount: manifest.sources.length,
      tableCount: manifest.tables.length,
      chartCount: manifest.charts.length,
      evidenceCount: manifest.evidence.length,
    },
  };
}

function compactTimestamp(value: string) {
  return value.replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}
