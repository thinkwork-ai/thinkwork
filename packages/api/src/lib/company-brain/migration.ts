import { GraphQLError } from "graphql";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  brainArtifactManifests,
  brainSubstrateEvents,
  brainSubstrateMigrations,
  brainSubstrateStates,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb, type Database } from "../db.js";

type BrainMigrationDb = Pick<Database, "select" | "insert" | "update"> & {
  transaction?<T>(fn: (tx: BrainMigrationDb) => Promise<T>): Promise<T>;
};

export type BrainSubstrateStateRow = typeof brainSubstrateStates.$inferSelect;
export type BrainSubstrateMigrationRow =
  typeof brainSubstrateMigrations.$inferSelect;
export type BrainSubstrateMigrationInsert =
  typeof brainSubstrateMigrations.$inferInsert;
export type BrainArtifactManifestRow =
  typeof brainArtifactManifests.$inferSelect;
export type BrainSubstrateEventInsert =
  typeof brainSubstrateEvents.$inferInsert;

export type BrainMigrationPhase =
  | "requested"
  | "snapshotting"
  | "provisioning"
  | "replaying"
  | "validating"
  | "cutover"
  | "completed"
  | "failed"
  | "rolled_back";

export type BrainMigrationStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "rolled_back"
  | "canceled";

export interface RequestCompanyBrainProductionMigrationInput {
  tenantId: string;
  requestedByUserId?: string | null;
  embeddingModel?: string | null;
  vectorDimension?: number | null;
  allowEmptySourceSet?: boolean | null;
  emptySourceReason?: string | null;
  operatorEvidence?: Record<string, unknown> | null;
}

export interface UpdateCompanyBrainMigrationInput {
  tenantId: string;
  migrationId: string;
  phase: BrainMigrationPhase;
  status?: BrainMigrationStatus | null;
  validationSummary?: Record<string, unknown> | null;
  operatorEvidence?: Record<string, unknown> | null;
  errorMessage?: string | null;
  rollbackWindowClosesAt?: Date | string | null;
}

export interface BrainMigrationDeps {
  runInTransaction?<T>(
    fn: (deps: BrainMigrationDeps) => Promise<T>,
  ): Promise<T>;
  getSubstrateState(tenantId: string): Promise<BrainSubstrateStateRow | null>;
  getMigration(args: {
    tenantId: string;
    migrationId: string;
  }): Promise<BrainSubstrateMigrationRow | null>;
  getActiveMigration(args: {
    tenantId: string;
    substrateId: string;
  }): Promise<BrainSubstrateMigrationRow | null>;
  listReplayManifests(tenantId: string): Promise<BrainArtifactManifestRow[]>;
  createMigration(
    values: BrainSubstrateMigrationInsert,
  ): Promise<BrainSubstrateMigrationRow>;
  updateMigration(args: {
    tenantId: string;
    migrationId: string;
    patch: Partial<typeof brainSubstrateMigrations.$inferInsert>;
  }): Promise<BrainSubstrateMigrationRow>;
  updateSubstrate(args: {
    tenantId: string;
    patch: Partial<typeof brainSubstrateStates.$inferInsert>;
  }): Promise<void>;
  appendEvent(values: BrainSubstrateEventInsert): Promise<void>;
  now(): Date;
}

const PHASE_ORDER: BrainMigrationPhase[] = [
  "requested",
  "snapshotting",
  "provisioning",
  "replaying",
  "validating",
  "cutover",
  "completed",
];

export function createDrizzleBrainMigrationDeps(
  db: BrainMigrationDb = defaultDb,
): BrainMigrationDeps {
  return {
    async runInTransaction(fn) {
      if (!db.transaction) return fn(createDrizzleBrainMigrationDeps(db));
      return db.transaction((tx) =>
        fn(createDrizzleBrainMigrationDeps(tx as BrainMigrationDb)),
      );
    },
    async getSubstrateState(tenantId) {
      const [row] = await db
        .select()
        .from(brainSubstrateStates)
        .where(eq(brainSubstrateStates.tenant_id, tenantId))
        .for("update");
      return row ?? null;
    },
    async getMigration({ tenantId, migrationId }) {
      const [row] = await db
        .select()
        .from(brainSubstrateMigrations)
        .where(
          and(
            eq(brainSubstrateMigrations.tenant_id, tenantId),
            eq(brainSubstrateMigrations.id, migrationId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async getActiveMigration({ tenantId, substrateId }) {
      const [row] = await db
        .select()
        .from(brainSubstrateMigrations)
        .where(
          and(
            eq(brainSubstrateMigrations.tenant_id, tenantId),
            eq(brainSubstrateMigrations.substrate_id, substrateId),
            inArray(brainSubstrateMigrations.status, ["requested", "running"]),
          ),
        )
        .orderBy(desc(brainSubstrateMigrations.created_at))
        .limit(1);
      return row ?? null;
    },
    async listReplayManifests(tenantId) {
      return db
        .select()
        .from(brainArtifactManifests)
        .where(
          and(
            eq(brainArtifactManifests.tenant_id, tenantId),
            eq(brainArtifactManifests.status, "active"),
            inArray(brainArtifactManifests.manifest_kind, [
              "source_artifact",
              "ingestion_manifest",
            ]),
          ),
        )
        .orderBy(desc(brainArtifactManifests.updated_at));
    },
    async createMigration(values) {
      const [row] = await db
        .insert(brainSubstrateMigrations)
        .values(values)
        .returning();
      if (!row) throw invariant("Company Brain migration was not created");
      return row;
    },
    async updateMigration({ tenantId, migrationId, patch }) {
      const [row] = await db
        .update(brainSubstrateMigrations)
        .set(patch)
        .where(
          and(
            eq(brainSubstrateMigrations.tenant_id, tenantId),
            eq(brainSubstrateMigrations.id, migrationId),
          ),
        )
        .returning();
      if (!row) throw notFound("Company Brain migration not found");
      return row;
    },
    async updateSubstrate({ tenantId, patch }) {
      await db
        .update(brainSubstrateStates)
        .set(patch)
        .where(eq(brainSubstrateStates.tenant_id, tenantId));
    },
    async appendEvent(values) {
      await db.insert(brainSubstrateEvents).values(values);
    },
    now: () => new Date(),
  };
}

function withMigrationTransaction<T>(
  deps: BrainMigrationDeps,
  fn: (deps: BrainMigrationDeps) => Promise<T>,
): Promise<T> {
  return deps.runInTransaction ? deps.runInTransaction(fn) : fn(deps);
}

export async function requestCompanyBrainProductionMigration(
  input: RequestCompanyBrainProductionMigrationInput,
  deps: BrainMigrationDeps = createDrizzleBrainMigrationDeps(),
): Promise<BrainSubstrateMigrationRow> {
  return withMigrationTransaction(deps, async (txDeps) => {
    const substrate = await txDeps.getSubstrateState(input.tenantId);
    if (!substrate) {
      throw badInput(
        "Company Brain substrate is not installed for this tenant",
      );
    }
    if (substrate.storage_tier !== "default") {
      throw badInput(
        "Company Brain production migration requires default tier",
      );
    }
    if (substrate.active_backend !== "default") {
      throw badInput("Company Brain migration requires default active backend");
    }
    if (substrate.status !== "ready") {
      throw badInput(`Company Brain substrate is ${substrate.status}`);
    }
    const activeMigration = await txDeps.getActiveMigration({
      tenantId: input.tenantId,
      substrateId: substrate.id,
    });
    if (activeMigration) {
      throw badInput("Company Brain production migration is already active");
    }

    const manifests = await txDeps.listReplayManifests(input.tenantId);
    const vectorDimension = normalizePositiveInt(
      input.vectorDimension ?? substrate.vector_dimension,
      "vectorDimension",
    );
    const embeddingModel =
      nonEmpty(input.embeddingModel) ?? nonEmpty(substrate.embedding_model);
    const validationSummary = buildRequestValidationSummary({
      input,
      substrate,
      manifests,
      vectorDimension,
      embeddingModel,
    });
    const now = txDeps.now();
    const migration = await txDeps.createMigration({
      tenant_id: input.tenantId,
      substrate_id: substrate.id,
      from_storage_tier: "default",
      to_storage_tier: "production",
      phase: "requested",
      status: "requested",
      requested_by_user_id: input.requestedByUserId ?? null,
      embedding_model: embeddingModel,
      vector_dimension: vectorDimension,
      validation_summary: validationSummary,
      operator_evidence: input.operatorEvidence ?? {},
      requested_at: now,
      created_at: now,
      updated_at: now,
    });

    await txDeps.updateSubstrate({
      tenantId: input.tenantId,
      patch: {
        status: "migrating",
        health_status: "degraded",
        updated_at: now,
        operator_evidence: mergeEvidence(substrate.operator_evidence, {
          latestMigrationId: migration.id,
        }),
      },
    });
    await txDeps.appendEvent({
      tenant_id: input.tenantId,
      substrate_id: substrate.id,
      migration_id: migration.id,
      event_type: "brain.migration.requested",
      message: "Company Brain production migration requested",
      payload: redactedMigrationEventPayload(migration),
      created_at: now,
    });

    return migration;
  });
}

export async function updateCompanyBrainMigration(
  input: UpdateCompanyBrainMigrationInput,
  deps: BrainMigrationDeps = createDrizzleBrainMigrationDeps(),
): Promise<BrainSubstrateMigrationRow> {
  return withMigrationTransaction(deps, async (txDeps) => {
    const [substrate, migration] = await Promise.all([
      txDeps.getSubstrateState(input.tenantId),
      txDeps.getMigration({
        tenantId: input.tenantId,
        migrationId: input.migrationId,
      }),
    ]);
    if (!substrate) {
      throw badInput(
        "Company Brain substrate is not installed for this tenant",
      );
    }
    if (!migration) throw notFound("Company Brain migration not found");
    validatePhaseTransition(migration, input);

    const now = txDeps.now();
    const status = normalizeStatusForPhase(input.phase, input.status);
    const validationSummary = publicValidationSummary(
      migration.validation_summary,
      input.validationSummary ?? {},
    );
    validateCutoverReadiness({
      phase: input.phase,
      status,
      validationSummary,
      migration,
      substrate,
    });

    const updated = await txDeps.updateMigration({
      tenantId: input.tenantId,
      migrationId: input.migrationId,
      patch: {
        phase: input.phase,
        status,
        validation_summary: validationSummary,
        operator_evidence: mergeEvidence(
          migration.operator_evidence,
          input.operatorEvidence ?? {},
        ),
        error_message:
          input.errorMessage === undefined
            ? migration.error_message
            : input.errorMessage,
        started_at:
          migration.started_at ?? (input.phase === "requested" ? null : now),
        completed_at: terminalPhase(input.phase) ? now : migration.completed_at,
        rollback_window_closes_at: normalizeDate(
          input.rollbackWindowClosesAt ?? migration.rollback_window_closes_at,
        ),
        updated_at: now,
      },
    });

    if (input.phase === "completed" && status === "completed") {
      await txDeps.updateSubstrate({
        tenantId: input.tenantId,
        patch: {
          storage_tier: "production",
          active_backend: "production",
          status: "ready",
          health_status: "healthy",
          updated_at: now,
          operator_evidence: mergeEvidence(substrate.operator_evidence, {
            latestMigrationId: migration.id,
            activeMigrationCompletedAt: now.toISOString(),
          }),
        },
      });
    } else if (input.phase === "failed" || status === "failed") {
      await txDeps.updateSubstrate({
        tenantId: input.tenantId,
        patch: {
          active_backend: substrate.active_backend,
          status: "degraded",
          health_status: "degraded",
          last_failure_message: input.errorMessage ?? migration.error_message,
          last_failure_at: now,
          updated_at: now,
        },
      });
    } else if (input.phase === "rolled_back" || status === "rolled_back") {
      await txDeps.updateSubstrate({
        tenantId: input.tenantId,
        patch: {
          storage_tier: "default",
          active_backend: "default",
          status: "ready",
          health_status: "healthy",
          updated_at: now,
        },
      });
    } else {
      await txDeps.updateSubstrate({
        tenantId: input.tenantId,
        patch: {
          status: "migrating",
          health_status: "degraded",
          updated_at: now,
        },
      });
    }

    await txDeps.appendEvent({
      tenant_id: input.tenantId,
      substrate_id: substrate.id,
      migration_id: migration.id,
      event_type: `brain.migration.${input.phase}`,
      message: `Company Brain migration moved to ${input.phase}`,
      payload: redactedMigrationEventPayload(updated),
      created_at: now,
    });

    return updated;
  });
}

function buildRequestValidationSummary(args: {
  input: RequestCompanyBrainProductionMigrationInput;
  substrate: BrainSubstrateStateRow;
  manifests: BrainArtifactManifestRow[];
  vectorDimension: number;
  embeddingModel: string | null;
}): Record<string, unknown> {
  const { input, manifests, vectorDimension, embeddingModel } = args;
  const totalSources = manifests.reduce(
    (sum, manifest) => sum + Number(manifest.source_count ?? 0),
    0,
  );
  const totalObjects = manifests.reduce(
    (sum, manifest) => sum + Number(manifest.object_count ?? 0),
    0,
  );
  if (totalSources === 0 && !input.allowEmptySourceSet) {
    throw badInput(
      "Company Brain migration requires replayable source manifests or an explicit empty-source approval",
    );
  }
  if (totalSources === 0 && !nonEmpty(input.emptySourceReason)) {
    throw badInput("emptySourceReason is required for empty-source migration");
  }

  const mismatchedDimensions = manifests
    .filter(
      (manifest) =>
        manifest.vector_dimension != null &&
        manifest.vector_dimension !== vectorDimension,
    )
    .map((manifest) => manifest.id);
  if (mismatchedDimensions.length > 0) {
    throw badInput("Manifest vector dimension does not match migration target");
  }

  const mismatchedModels =
    embeddingModel == null
      ? []
      : manifests
          .filter(
            (manifest) =>
              manifest.embedding_model != null &&
              manifest.embedding_model !== embeddingModel,
          )
          .map((manifest) => manifest.id);
  if (mismatchedModels.length > 0) {
    throw badInput("Manifest embedding model does not match migration target");
  }

  return {
    replayManifestCount: manifests.length,
    sourceCount: totalSources,
    objectCount: totalObjects,
    vectorDimension,
    embeddingModel,
    emptySourceApproved: totalSources === 0,
    emptySourceReason:
      totalSources === 0 ? nonEmpty(input.emptySourceReason) : null,
    validationPassed: false,
  };
}

function validatePhaseTransition(
  migration: BrainSubstrateMigrationRow,
  input: UpdateCompanyBrainMigrationInput,
) {
  const currentPhase = migration.phase as BrainMigrationPhase;
  if (currentPhase === "failed" && input.phase === "rolled_back") return;
  if (terminalPhase(currentPhase)) {
    throw badInput("Company Brain migration is already terminal");
  }
  if (input.phase === "failed") return;
  if (input.phase === "rolled_back") {
    throw badInput("Rollback requires a failed Company Brain migration");
  }
  const currentIndex = PHASE_ORDER.indexOf(currentPhase);
  const nextIndex = PHASE_ORDER.indexOf(input.phase);
  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    (nextIndex !== currentIndex && nextIndex !== currentIndex + 1)
  ) {
    throw badInput("Invalid Company Brain migration phase transition");
  }
}

function validateCutoverReadiness(args: {
  phase: BrainMigrationPhase;
  status: BrainMigrationStatus;
  validationSummary: Record<string, unknown>;
  migration: BrainSubstrateMigrationRow;
  substrate: BrainSubstrateStateRow;
}) {
  if (args.phase !== "cutover" && args.phase !== "completed") return;
  if (args.status !== "running" && args.status !== "completed") {
    throw badInput("Cutover requires running or completed migration status");
  }
  if (args.validationSummary.validationPassed !== true) {
    throw badInput("Cutover requires validationPassed evidence");
  }
  const expectedDimension = args.migration.vector_dimension;
  const observedDimension = Number(args.validationSummary.vectorDimension);
  if (
    expectedDimension != null &&
    (!Number.isFinite(observedDimension) ||
      observedDimension !== expectedDimension)
  ) {
    throw badInput("Cutover vector dimension evidence does not match request");
  }
  if (args.substrate.active_backend !== "default") {
    throw badInput("Cutover requires default to remain the active backend");
  }
}

function normalizeStatusForPhase(
  phase: BrainMigrationPhase,
  requestedStatus: BrainMigrationStatus | null | undefined,
): BrainMigrationStatus {
  const expected = statusForPhase(phase);
  if (!requestedStatus) return expected;
  if (phase === "cutover" && requestedStatus === "completed") {
    throw badInput("Completed status requires completed migration phase");
  }
  if (requestedStatus !== expected) {
    throw badInput("Company Brain migration status does not match phase");
  }
  return requestedStatus;
}

function statusForPhase(phase: BrainMigrationPhase): BrainMigrationStatus {
  if (phase === "requested") return "requested";
  if (phase === "completed") return "completed";
  if (phase === "failed") return "failed";
  if (phase === "rolled_back") return "rolled_back";
  return "running";
}

function terminalPhase(phase: string): boolean {
  return phase === "completed" || phase === "failed" || phase === "rolled_back";
}

function normalizePositiveInt(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badInput(`${name} must be a positive integer`);
  }
  return parsed;
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badInput("rollbackWindowClosesAt must be a valid date");
  }
  return date;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mergeEvidence(
  prior: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const priorRecord =
    prior && typeof prior === "object" && !Array.isArray(prior)
      ? (prior as Record<string, unknown>)
      : {};
  return { ...priorRecord, ...next };
}

function publicValidationSummary(
  prior: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = mergeEvidence(prior, next);
  const summary: Record<string, unknown> = {};
  copyNumber(summary, merged, "replayManifestCount");
  copyNumber(summary, merged, "sourceCount");
  copyNumber(summary, merged, "objectCount");
  copyNumber(summary, merged, "graphEntityCount");
  copyNumber(summary, merged, "graphEdgeCount");
  copyNumber(summary, merged, "vectorDimension");
  copyString(summary, merged, "embeddingModel");
  copyString(summary, merged, "ontologyVersion");
  copyBoolean(summary, merged, "emptySourceApproved");
  copyString(summary, merged, "emptySourceReason");
  copyBoolean(summary, merged, "validationPassed");
  copyBoolean(summary, merged, "vectorIndexHealthy");
  copyBoolean(summary, merged, "retrievalParityPassed");
  return summary;
}

function copyNumber(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
) {
  const value = Number(source[key]);
  if (Number.isFinite(value)) target[key] = value;
}

function copyString(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
) {
  const value = nonEmpty(source[key]);
  if (value) target[key] = value;
}

function copyBoolean(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
) {
  if (typeof source[key] === "boolean") target[key] = source[key];
}

function redactedMigrationEventPayload(
  migration: BrainSubstrateMigrationRow,
): Record<string, unknown> {
  return {
    migrationId: migration.id,
    phase: migration.phase,
    status: migration.status,
    fromStorageTier: migration.from_storage_tier,
    toStorageTier: migration.to_storage_tier,
    validationSummary: migration.validation_summary,
  };
}

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

function invariant(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  });
}
