import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { artifacts } from "../src/schema/artifacts";
import {
  ARTIFACT_BINDING_AUTH_CONTEXTS,
  ARTIFACT_BINDING_QUALITIES,
  artifactDataBindings,
} from "../src/schema/artifact-data-bindings";
import { artifactVersions } from "../src/schema/artifact-versions";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0209_living_artifacts_schema.sql"),
  "utf-8",
);

describe("Living Artifacts schema (THINK-145 U1)", () => {
  it("adds space linkage + version-chain head columns to artifacts (additive, nullable space)", () => {
    const columns = getTableColumns(artifacts);

    // space_id is nullable — draft/legacy artifacts have no space.
    expect(columns.space_id.notNull).toBe(false);
    // head_version / head_write_seq are non-null with a 0 default so existing
    // rows migrate cleanly.
    expect(columns.head_version.notNull).toBe(true);
    expect(columns.head_version.default).toBe(0);
    expect(columns.head_write_seq.notNull).toBe(true);
    expect(columns.head_write_seq.default).toBe(0);
  });

  it("wires the artifacts.space_id FK as ON DELETE RESTRICT — never cascade into spaces.*", () => {
    const { foreignKeys } = getTableConfig(artifacts);
    const spaceFk = foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === "space_id"),
    );
    expect(spaceFk).toBeDefined();
    expect(spaceFk?.onDelete).toBe("restrict");
    // The migration must express RESTRICT and must NOT cascade the space delete.
    expect(migration).toMatch(
      /space_id uuid REFERENCES spaces\(id\) ON DELETE RESTRICT/,
    );
  });

  it("models the content-addressed artifact_versions chain with per-artifact unique versions", () => {
    const columns = getTableColumns(artifactVersions);

    expect(getTableName(artifactVersions)).toBe("artifact_versions");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.artifact_id.notNull).toBe(true);
    expect(columns.version.notNull).toBe(true);
    expect(columns.s3_key.notNull).toBe(true);
    expect(columns.content_hash.notNull).toBe(true);
    // created_by nullable so user deletion doesn't orphan the chain.
    expect(columns.created_by.notNull).toBe(false);

    const { indexes } = getTableConfig(artifactVersions);
    const uniq = indexes.find(
      (i) => i.config.name === "uq_artifact_versions_artifact_version",
    );
    expect(uniq?.config.unique).toBe(true);
    expect(uniq?.config.columns.map((c: any) => c.name)).toEqual([
      "artifact_id",
      "version",
    ]);
  });

  it("models artifact_data_bindings keyed uniquely on (artifact, part, element)", () => {
    const columns = getTableColumns(artifactDataBindings);

    expect(getTableName(artifactDataBindings)).toBe("artifact_data_bindings");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.artifact_id.notNull).toBe(true);
    expect(columns.part_id.notNull).toBe(true);
    expect(columns.element_id.notNull).toBe(true);
    expect(columns.mcp_server_ref.notNull).toBe(true);
    expect(columns.server_name.notNull).toBe(true);
    expect(columns.tool_name.notNull).toBe(true);
    expect(columns.frozen_args.notNull).toBe(true);
    expect(columns.result_shape_hash.notNull).toBe(true);
    expect(columns.auth_context.notNull).toBe(true);
    // owner_user_id nullable — set only for per-user-OAuth bindings.
    expect(columns.owner_user_id.notNull).toBe(false);
    expect(columns.quality.notNull).toBe(true);
    expect(columns.quality.default).toBe("good");
    expect(columns.last_fetched_at.notNull).toBe(false);
    expect(columns.last_good_at.notNull).toBe(false);

    const { indexes } = getTableConfig(artifactDataBindings);
    const uniq = indexes.find(
      (i) => i.config.name === "uq_artifact_data_bindings_element",
    );
    expect(uniq?.config.unique).toBe(true);
    expect(uniq?.config.columns.map((c: any) => c.name)).toEqual([
      "artifact_id",
      "part_id",
      "element_id",
    ]);
  });

  it("constrains binding auth-context and quality to the allowed tokens", () => {
    expect([...ARTIFACT_BINDING_AUTH_CONTEXTS]).toEqual([
      "tenant_mcp",
      "per_user_oauth",
    ]);
    expect([...ARTIFACT_BINDING_QUALITIES]).toEqual([
      "good",
      "stale",
      "bad",
      "schema_stale",
    ]);

    const { checks } = getTableConfig(artifactDataBindings);
    const checkNames = checks.map((c) => c.name);
    expect(checkNames).toContain("artifact_data_bindings_auth_context_allowed");
    expect(checkNames).toContain("artifact_data_bindings_quality_allowed");
  });

  it("declares drift-gate markers and cascades versions/bindings with their artifact", () => {
    // Hand-rolled migration must carry -- creates: markers for the drift gate.
    expect(migration).toMatch(/-- creates-column: public\.artifacts\.space_id/);
    expect(migration).toMatch(/-- creates: public\.artifact_versions/);
    expect(migration).toMatch(/-- creates: public\.artifact_data_bindings/);
    // Child rows cascade on artifact delete.
    expect(migration).toMatch(
      /artifact_id uuid NOT NULL REFERENCES artifacts\(id\) ON DELETE CASCADE/,
    );
  });
});
