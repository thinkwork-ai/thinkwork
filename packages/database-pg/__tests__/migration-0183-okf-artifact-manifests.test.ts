import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  BRAIN_ARTIFACT_MANIFEST_KINDS,
  brainArtifactManifests,
} from "../src/schema/brain";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0183 = readFileSync(
  join(HERE, "..", "drizzle", "0183_okf_artifact_manifests.sql"),
  "utf-8",
);

describe("migration 0183 — OKF artifact manifests", () => {
  it("extends artifact manifest vocabularies for OKF bundle evidence", () => {
    expect(BRAIN_ARTIFACT_MANIFEST_KINDS).toEqual([
      "source_artifact",
      "ingestion_manifest",
      "migration_snapshot",
      "vault_projection",
      "export",
      "okf_bundle",
      "okf_current_manifest",
    ]);

    const checks = getTableConfig(brainArtifactManifests).checks;
    expect(checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "brain_artifact_manifests_kind_allowed",
        "brain_artifact_manifests_source_kind_allowed",
      ]),
    );
  });

  it("widens CHECK constraints and declares manual drift markers", () => {
    expect(migration0183).toContain("'okf_bundle'");
    expect(migration0183).toContain("'okf_current_manifest'");
    expect(migration0183).toContain("'okf'");

    for (const marker of [
      "brain.artifact_manifests.brain_artifact_manifests_kind_allowed",
      "brain.artifact_manifests.brain_artifact_manifests_source_kind_allowed",
    ]) {
      expect(migration0183).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0183).toContain(marker.split(".").pop());
    }
  });
});
