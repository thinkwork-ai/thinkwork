import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/schema";
import {
  PI_EXTENSION_ASSIGNMENT_TARGET_TYPES,
  PI_EXTENSION_SOURCE_TYPES,
  PI_EXTENSION_VERSION_STATUSES,
  piExtensionAssignments,
  piExtensionSources,
  piExtensionVersions,
} from "../src/schema/pi-extensions";

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

describe("Pi extension registry schema", () => {
  it("exports Pi extension tables and vocabularies from the schema barrel", () => {
    expect(schema.piExtensionSources).toBe(piExtensionSources);
    expect(schema.piExtensionVersions).toBe(piExtensionVersions);
    expect(schema.piExtensionAssignments).toBe(piExtensionAssignments);
    expect(schema.PI_EXTENSION_SOURCE_TYPES).toBe(PI_EXTENSION_SOURCE_TYPES);
    expect(schema.PI_EXTENSION_VERSION_STATUSES).toBe(
      PI_EXTENSION_VERSION_STATUSES,
    );
    expect(schema.PI_EXTENSION_ASSIGNMENT_TARGET_TYPES).toBe(
      PI_EXTENSION_ASSIGNMENT_TARGET_TYPES,
    );
  });

  it("stores GitHub sources separately from reviewed immutable versions", () => {
    expect(getTableName(piExtensionSources)).toBe("pi_extension_sources");
    const sourceColumns = getTableColumns(piExtensionSources);
    expect(sourceColumns.tenant_id.notNull).toBe(true);
    expect(sourceColumns.source_type.default).toBe("github");
    expect(sourceColumns.repository_url.notNull).toBe(true);
    expect(indexNames(piExtensionSources)).toEqual(
      expect.arrayContaining([
        "uq_pi_extension_sources_tenant_repository",
        "idx_pi_extension_sources_tenant",
      ]),
    );
    expect(checkNames(piExtensionSources)).toContain(
      "pi_extension_sources_source_type_check",
    );

    expect(getTableName(piExtensionVersions)).toBe("pi_extension_versions");
    const versionColumns = getTableColumns(piExtensionVersions);
    expect(versionColumns.tenant_id.notNull).toBe(true);
    expect(versionColumns.source_id.notNull).toBe(true);
    expect(versionColumns.source_ref.notNull).toBe(true);
    expect(versionColumns.commit_sha.notNull).toBe(false);
    expect(versionColumns.artifact_hash.notNull).toBe(false);
    expect(versionColumns.artifact_uri.notNull).toBe(false);
    expect(versionColumns.status.default).toBe("imported");
    expect(versionColumns.tool_names.notNull).toBe(true);
    expect(versionColumns.permission_classes.notNull).toBe(true);
    expect(versionColumns.verification_report.notNull).toBe(true);
    expect(indexNames(piExtensionVersions)).toEqual(
      expect.arrayContaining([
        "uq_pi_extension_versions_source_commit",
        "idx_pi_extension_versions_tenant_status",
        "idx_pi_extension_versions_source",
      ]),
    );
    expect(checkNames(piExtensionVersions)).toContain(
      "pi_extension_versions_status_check",
    );
  });

  it("models executable state as explicit target assignments", () => {
    expect(getTableName(piExtensionAssignments)).toBe(
      "pi_extension_assignments",
    );
    const columns = getTableColumns(piExtensionAssignments);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.version_id.notNull).toBe(true);
    expect(columns.target_type.notNull).toBe(true);
    expect(columns.agent_profile_id.notNull).toBe(false);
    expect(columns.enabled.default).toBe(true);
    expect(columns.granted_permissions.notNull).toBe(true);
    expect(indexNames(piExtensionAssignments)).toEqual(
      expect.arrayContaining([
        "uq_pi_extension_assignments_default_version",
        "uq_pi_extension_assignments_profile_version",
        "idx_pi_extension_assignments_tenant_target",
        "idx_pi_extension_assignments_version",
      ]),
    );
    expect(checkNames(piExtensionAssignments)).toEqual(
      expect.arrayContaining([
        "pi_extension_assignments_target_type_check",
        "pi_extension_assignments_profile_target_check",
      ]),
    );
  });
});
