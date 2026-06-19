export type DeleteReversalStrategy =
  | "append_only"
  | "soft_delete_flag"
  | "reversal_transaction"
  | "rolling_reconciliation";

export interface ReconciliationWindow {
  mode: "rolling_window";
  lookbackHours: number;
  reason: string;
}

export interface RawLandingMetadataContract {
  bucketRef: string;
  prefixTemplate: string;
  format: "jsonl" | "parquet" | "csv";
  requiredMetadataFields: string[];
}

export interface LakeHouseExtractContract {
  streamName: string;
  sourceSystem: "jde" | "oracle" | string;
  sourceObject: string;
  businessKeys: string[];
  cursorField: string;
  sourceTimestampField: string;
  extractTimestampField: string;
  expectedPrimaryKeyFields?: string[];
  reconciliation: ReconciliationWindow;
  deleteReversalStrategy: DeleteReversalStrategy;
  rawLanding: RawLandingMetadataContract;
  notes?: string;
}

export interface ContractValidationIssue {
  path: string;
  message: string;
}

export interface ContractValidationResult {
  ok: boolean;
  issues: ContractValidationIssue[];
}

const REQUIRED_RAW_METADATA_FIELDS = [
  "source_system",
  "source_object",
  "bundle_version",
  "run_id",
  "extract_window",
  "row_count",
  "schema_snapshot",
  "loaded_at",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
  );
}

export function validateExtractContract(
  extract: LakeHouseExtractContract,
  basePath = "extract",
): ContractValidationResult {
  const issues: ContractValidationIssue[] = [];

  for (const field of [
    "streamName",
    "sourceSystem",
    "sourceObject",
    "cursorField",
    "sourceTimestampField",
    "extractTimestampField",
  ] as const) {
    if (!isNonEmptyString(extract[field])) {
      issues.push({
        path: `${basePath}.${field}`,
        message: "Required field must be a non-empty string",
      });
    }
  }

  if (!hasNonEmptyStrings(extract.businessKeys)) {
    issues.push({
      path: `${basePath}.businessKeys`,
      message: "At least one stable business key is required",
    });
  }

  if (
    !extract.reconciliation ||
    extract.reconciliation.mode !== "rolling_window"
  ) {
    issues.push({
      path: `${basePath}.reconciliation.mode`,
      message: "A rolling-window reconciliation strategy is required",
    });
  } else {
    if (
      !Number.isInteger(extract.reconciliation.lookbackHours) ||
      extract.reconciliation.lookbackHours <= 0
    ) {
      issues.push({
        path: `${basePath}.reconciliation.lookbackHours`,
        message: "Rolling-window reconciliation requires a positive lookback",
      });
    }
    if (!isNonEmptyString(extract.reconciliation.reason)) {
      issues.push({
        path: `${basePath}.reconciliation.reason`,
        message: "Reconciliation reason is required for operator review",
      });
    }
  }

  if (!isNonEmptyString(extract.deleteReversalStrategy)) {
    issues.push({
      path: `${basePath}.deleteReversalStrategy`,
      message: "Delete/reversal handling strategy is required",
    });
  }

  if (!extract.rawLanding) {
    issues.push({
      path: `${basePath}.rawLanding`,
      message: "Raw landing metadata contract is required",
    });
  } else {
    if (!isNonEmptyString(extract.rawLanding.bucketRef)) {
      issues.push({
        path: `${basePath}.rawLanding.bucketRef`,
        message: "Raw landing bucket reference is required",
      });
    }
    if (!isNonEmptyString(extract.rawLanding.prefixTemplate)) {
      issues.push({
        path: `${basePath}.rawLanding.prefixTemplate`,
        message: "Raw landing prefix template is required",
      });
    }
    const missingMetadata = REQUIRED_RAW_METADATA_FIELDS.filter(
      (field) => !extract.rawLanding.requiredMetadataFields?.includes(field),
    );
    if (missingMetadata.length > 0) {
      issues.push({
        path: `${basePath}.rawLanding.requiredMetadataFields`,
        message: `Missing raw landing metadata fields: ${missingMetadata.join(", ")}`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

export function requiredRawLandingMetadataFields(): string[] {
  return [...REQUIRED_RAW_METADATA_FIELDS];
}
