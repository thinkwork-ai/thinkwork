import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { brainArtifactManifests } from "../src/schema/brain";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0167 = readFileSync(
  join(
    HERE,
    "..",
    "drizzle",
    "0167_company_brain_artifact_manifest_runtime.sql",
  ),
  "utf-8",
);

describe("migration 0167 — Company Brain artifact manifest runtime metadata", () => {
  it("links artifact manifests to Knowledge Graph ingest runs and source metadata", () => {
    const columns = getTableColumns(brainArtifactManifests);

    expect(columns.ingest_run_id.notNull).toBe(false);
    expect(columns.source_kind.notNull).toBe(false);
    expect(columns.source_type.notNull).toBe(false);
    expect(columns.source_ids.notNull).toBe(true);
    expect(columns.source_ids.default).toBeDefined();
    expect(columns.object_version_id.notNull).toBe(false);
    expect(columns.content_type.notNull).toBe(false);
    expect(columns.content_encoding.notNull).toBe(false);
    expect(columns.byte_length.notNull).toBe(false);
    expect(columns.ontology_mechanism.notNull).toBe(false);
    expect(columns.metadata.notNull).toBe(true);

    const config = getTableConfig(brainArtifactManifests);
    expect(config.foreignKeys.map((fk) => fk.getName())).toContain(
      "artifact_manifests_ingest_run_id_fk",
    );
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "brain_artifact_manifests_ingest_run_idx",
        "brain_artifact_manifests_source_kind_idx",
      ]),
    );
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "brain_artifact_manifests_source_kind_allowed",
        "brain_artifact_manifests_byte_nonneg",
      ]),
    );
  });

  it("declares drift markers for runtime manifest columns, indexes, and constraints", () => {
    for (const marker of [
      "brain.artifact_manifests.ingest_run_id",
      "brain.artifact_manifests.source_kind",
      "brain.artifact_manifests.source_type",
      "brain.artifact_manifests.source_ids",
      "brain.artifact_manifests.object_version_id",
      "brain.artifact_manifests.content_type",
      "brain.artifact_manifests.content_encoding",
      "brain.artifact_manifests.byte_length",
      "brain.artifact_manifests.ontology_mechanism",
      "brain.artifact_manifests.metadata",
    ]) {
      expect(migration0167).toMatch(
        new RegExp(`--\\s*creates-column:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "brain.brain_artifact_manifests_ingest_run_idx",
      "brain.brain_artifact_manifests_source_kind_idx",
    ]) {
      expect(migration0167).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
      expect(migration0167).toContain(marker.replace("brain.", ""));
    }

    for (const marker of [
      "brain.artifact_manifests.artifact_manifests_ingest_run_id_fk",
      "brain.artifact_manifests.brain_artifact_manifests_source_kind_allowed",
      "brain.artifact_manifests.brain_artifact_manifests_byte_nonneg",
    ]) {
      expect(migration0167).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0167).toContain(marker.split(".").pop());
    }
  });
});
