/**
 * cost-bill-reconciler
 *
 * Imports AWS Data Exports/CUR 2.0 files from S3 and reconciles aggregate bill
 * spend against ThinkWork cost rows. Scheduled runs use optional env config;
 * targeted events can import a specific manifest or reconcile an existing
 * import id for operator repair.
 */

import type { ScheduledEvent } from "aws-lambda";
import {
  loadCurExportFromS3,
  type CurS3ClientLike,
} from "../lib/billing-reconciliation/aws-cur-import.js";
import {
  persistBillingExportImport,
  reconcileBillingImport,
} from "../lib/billing-reconciliation/bill-reconciler.js";

type TargetedEvent = {
  manifestBucket?: unknown;
  manifestKey?: unknown;
  importId?: unknown;
  toleranceUsd?: unknown;
};

const DEFAULT_TOLERANCE_USD = envNumber(
  "BILLING_RECONCILIATION_TOLERANCE_USD",
  0.01,
);

export async function handler(
  event: ScheduledEvent | TargetedEvent,
): Promise<unknown> {
  const targeted = event as TargetedEvent;
  const toleranceUsd =
    numberValue(targeted.toleranceUsd) ?? DEFAULT_TOLERANCE_USD;

  if (typeof targeted.importId === "string" && targeted.importId.trim()) {
    const decisions = await reconcileBillingImport({
      importId: targeted.importId,
      toleranceUsd,
    });
    return logResult("cost-bill-reconciler.reconcile-import.complete", {
      importId: targeted.importId,
      decisions,
    });
  }

  const manifestBucket =
    stringValue(targeted.manifestBucket) ??
    stringValue(process.env.BILLING_EXPORT_BUCKET);
  const manifestKey =
    stringValue(targeted.manifestKey) ??
    stringValue(process.env.BILLING_EXPORT_MANIFEST_KEY);

  if (!manifestBucket || !manifestKey) {
    return logResult("cost-bill-reconciler.skipped", {
      reason: "missing-billing-export-config",
    });
  }

  const result = await importAndReconcileBillingManifest({
    manifestBucket,
    manifestKey,
    toleranceUsd,
  });
  return logResult("cost-bill-reconciler.import.complete", result);
}

export async function importAndReconcileBillingManifest(input: {
  manifestBucket: string;
  manifestKey: string;
  toleranceUsd?: number;
  s3Client?: CurS3ClientLike;
}) {
  const loaded = await loadCurExportFromS3({
    manifestBucket: input.manifestBucket,
    manifestKey: input.manifestKey,
    s3Client: input.s3Client,
  });
  const imported = await persistBillingExportImport({
    manifestBucket: input.manifestBucket,
    manifestKey: input.manifestKey,
    billingPeriodStart: loaded.manifest.billingPeriodStart,
    billingPeriodEnd: loaded.manifest.billingPeriodEnd,
    lineItems: loaded.lineItems,
    errorRows: loaded.errors.length,
    metadata: {
      source: "cost_bill_reconciler",
      manifest: loaded.manifest.raw,
      parse_errors: loaded.errors.slice(0, 50),
    },
  });
  const decisions = await reconcileBillingImport({
    importId: imported.importId,
    toleranceUsd: input.toleranceUsd,
  });
  return {
    importId: imported.importId,
    importedRows: imported.importedRows,
    errorRows: imported.errorRows,
    decisions: decisions.map((decision) => ({
      state: decision.state,
      reason: decision.reason,
      provider: decision.provider,
      serviceCode: decision.serviceCode,
      operation: decision.operation,
      model: decision.model,
      tenantId: decision.tenantId,
      attributionLevel: decision.attributionLevel,
      allocationConfidence: decision.allocationConfidence,
      projectedAmountUsd: decision.projectedAmountUsd,
      billedAmountUsd: decision.billedAmountUsd,
      varianceUsd: decision.varianceUsd,
      costEventCount: decision.costEventIdsToUpdate.length,
    })),
  };
}

function logResult(message: string, payload: Record<string, unknown>) {
  const result = { msg: message, ...payload };
  console.log(JSON.stringify(result));
  return result;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
