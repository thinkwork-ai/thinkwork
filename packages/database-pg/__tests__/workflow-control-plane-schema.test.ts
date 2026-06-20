import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/schema";
import {
  WORKFLOW_BINDING_STATUSES,
  WORKFLOW_BINDING_TYPES,
  workflowEngineBindings,
} from "../src/schema/workflow-bindings";
import {
  WORKFLOW_RUN_STATUSES,
  workflowEvidence,
  workflowRunEvents,
  workflowRuns,
} from "../src/schema/workflow-runs";
import {
  WORKFLOW_LIFECYCLE_STATUSES,
  WORKFLOW_READINESS_STATES,
  WORKFLOW_TRIGGER_FAMILIES,
  workflowTriggers,
  workflowVersions,
  workflows,
} from "../src/schema/workflows";

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function checkNames(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).checks.map((check) => check.name);
}

describe("workflow control-plane schema", () => {
  it("exports workflow tables and vocabularies from the schema barrel", () => {
    expect(schema.workflows).toBe(workflows);
    expect(schema.workflowVersions).toBe(workflowVersions);
    expect(schema.workflowTriggers).toBe(workflowTriggers);
    expect(schema.workflowEngineBindings).toBe(workflowEngineBindings);
    expect(schema.workflowRuns).toBe(workflowRuns);
    expect(schema.workflowRunEvents).toBe(workflowRunEvents);
    expect(schema.workflowEvidence).toBe(workflowEvidence);

    expect(schema.WORKFLOW_LIFECYCLE_STATUSES).toBe(
      WORKFLOW_LIFECYCLE_STATUSES,
    );
    expect(schema.WORKFLOW_TRIGGER_FAMILIES).toBe(WORKFLOW_TRIGGER_FAMILIES);
    expect(schema.WORKFLOW_READINESS_STATES).toBe(WORKFLOW_READINESS_STATES);
    expect(schema.WORKFLOW_BINDING_TYPES).toBe(WORKFLOW_BINDING_TYPES);
    expect(schema.WORKFLOW_BINDING_STATUSES).toBe(WORKFLOW_BINDING_STATUSES);
    expect(schema.WORKFLOW_RUN_STATUSES).toBe(WORKFLOW_RUN_STATUSES);
  });

  it("models canonical workflow identity separate from Routine rows", () => {
    expect(getTableName(workflows)).toBe("workflows");
    const columns = getTableColumns(workflows);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.name.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.lifecycle_status.default).toBe("draft");
    expect(columns.visibility.default).toBe("tenant_shared");
    expect(columns.primary_trigger_family.default).toBe("manual");
    expect(columns.readiness_state.default).toBe("unknown");
    expect(columns.current_version_id.notNull).toBe(false);
    expect(columns.capability_flags.notNull).toBe(true);
    expect(columns.last_run_at.notNull).toBe(false);

    expect(indexNames(workflows)).toEqual(
      expect.arrayContaining([
        "workflows_tenant_slug_uidx",
        "workflows_tenant_lifecycle_idx",
        "workflows_tenant_readiness_idx",
        "workflows_tenant_last_run_idx",
      ]),
    );
    expect(checkNames(workflows)).toEqual(
      expect.arrayContaining([
        "workflows_lifecycle_status_check",
        "workflows_visibility_check",
        "workflows_trigger_family_check",
        "workflows_readiness_state_check",
      ]),
    );
  });

  it("keeps version and trigger records tied to workflow identity", () => {
    const versionColumns = getTableColumns(workflowVersions);
    expect(getTableName(workflowVersions)).toBe("workflow_versions");
    expect(versionColumns.tenant_id.notNull).toBe(true);
    expect(versionColumns.workflow_id.notNull).toBe(true);
    expect(versionColumns.version_number.notNull).toBe(true);
    expect(versionColumns.version_status.default).toBe("draft");
    expect(versionColumns.routine_asl_version_id.notNull).toBe(false);
    expect(versionColumns.definition_snapshot.notNull).toBe(true);
    expect(versionColumns.capability_snapshot.notNull).toBe(true);
    expect(indexNames(workflowVersions)).toEqual(
      expect.arrayContaining([
        "workflow_versions_workflow_version_uidx",
        "workflow_versions_tenant_workflow_idx",
      ]),
    );

    const triggerColumns = getTableColumns(workflowTriggers);
    expect(getTableName(workflowTriggers)).toBe("workflow_triggers");
    expect(triggerColumns.workflow_id.notNull).toBe(true);
    expect(triggerColumns.trigger_family.notNull).toBe(true);
    expect(triggerColumns.enabled.default).toBe(true);
    expect(triggerColumns.idempotency_required.default).toBe(true);
    expect(triggerColumns.readiness_state.default).toBe("unknown");
    expect(indexNames(workflowTriggers)).toEqual(
      expect.arrayContaining([
        "workflow_triggers_workflow_enabled_idx",
        "workflow_triggers_tenant_family_idx",
      ]),
    );
  });

  it("allows Step Functions Routine bindings without mutating routines", () => {
    expect(getTableName(workflowEngineBindings)).toBe(
      "workflow_engine_bindings",
    );
    const columns = getTableColumns(workflowEngineBindings);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.workflow_id.notNull).toBe(true);
    expect(columns.binding_type.notNull).toBe(true);
    expect(columns.binding_status.default).toBe("configured");
    expect(columns.routine_id.notNull).toBe(false);
    expect(columns.routine_asl_version_id.notNull).toBe(false);
    expect(columns.plugin_install_id.notNull).toBe(false);
    expect(columns.managed_application_id.notNull).toBe(false);
    expect(columns.external_workflow_id.notNull).toBe(false);
    expect(columns.capability_flags.notNull).toBe(true);
    expect(columns.readiness_state.default).toBe("unknown");
    expect(indexNames(workflowEngineBindings)).toEqual(
      expect.arrayContaining([
        "workflow_engine_bindings_workflow_idx",
        "workflow_engine_bindings_tenant_type_idx",
        "workflow_engine_bindings_step_routine_uidx",
        "workflow_engine_bindings_external_uidx",
      ]),
    );
  });

  it("stores canonical run identity, capability snapshots, events, and evidence", () => {
    expect(getTableName(workflowRuns)).toBe("workflow_runs");
    const runColumns = getTableColumns(workflowRuns);
    expect(runColumns.workflow_id.notNull).toBe(true);
    expect(runColumns.workflow_version_id.notNull).toBe(false);
    expect(runColumns.engine_binding_id.notNull).toBe(false);
    expect(runColumns.status.default).toBe("queued");
    expect(runColumns.trigger_family.notNull).toBe(true);
    expect(runColumns.actor_type.notNull).toBe(false);
    expect(runColumns.idempotency_key.notNull).toBe(false);
    expect(runColumns.backend_execution_id.notNull).toBe(false);
    expect(runColumns.capability_snapshot.notNull).toBe(true);
    expect(runColumns.readiness_snapshot.notNull).toBe(true);
    expect(indexNames(workflowRuns)).toEqual(
      expect.arrayContaining([
        "workflow_runs_tenant_status_idx",
        "workflow_runs_workflow_created_idx",
        "workflow_runs_tenant_idempotency_uidx",
      ]),
    );

    expect(getTableName(workflowRunEvents)).toBe("workflow_run_events");
    const eventColumns = getTableColumns(workflowRunEvents);
    expect(eventColumns.workflow_run_id.notNull).toBe(true);
    expect(eventColumns.event_type.notNull).toBe(true);
    expect(eventColumns.provenance.notNull).toBe(true);
    expect(eventColumns.payload_summary.notNull).toBe(true);
    expect(indexNames(workflowRunEvents)).toEqual(
      expect.arrayContaining([
        "workflow_run_events_run_occurred_idx",
        "workflow_run_events_tenant_type_idx",
      ]),
    );

    expect(getTableName(workflowEvidence)).toBe("workflow_evidence");
    const evidenceColumns = getTableColumns(workflowEvidence);
    expect(evidenceColumns.workflow_id.notNull).toBe(true);
    expect(evidenceColumns.workflow_run_id.notNull).toBe(false);
    expect(evidenceColumns.evidence_type.notNull).toBe(true);
    expect(evidenceColumns.source_system.notNull).toBe(true);
    expect(evidenceColumns.redaction_state.default).toBe("summary_only");
    expect(indexNames(workflowEvidence)).toEqual(
      expect.arrayContaining([
        "workflow_evidence_run_idx",
        "workflow_evidence_workflow_idx",
        "workflow_evidence_source_idx",
      ]),
    );
  });
});
