/**
 * AWS Lambda entry point for the nightly LastMile → Twenty sync.
 *
 * Invoked by n8n (Schedule → AWS Lambda) in TEI's account, where the function
 * can reach both the LastMile RDS and crm.tei.thinkwork.ai. Reads the same
 * three env vars as the CLI and runs an APPLY (delta re-sync) by default; pass
 * `{"mode":"dry-run"}` to read + report without writing. Returns the parity
 * report so n8n can log it or branch on failures.
 *
 * The sync is idempotent (upsert by sourceId + deletion mirror), reads LastMile
 * read-only, never provisions members, and needs no AWS credentials. Runtime is
 * ~90s against TEI's current data — set the Lambda timeout to 300s for headroom.
 *
 * Build the deployment zip with scripts/build-lambda.sh; deploy per
 * scripts/LAMBDA_DEPLOY.md. Handler string: `index.handler`.
 */
import { executeMigration } from "./migrate-lastmile";

interface SyncEvent {
  mode?: "apply" | "dry-run";
}

interface EntityFailures {
  failed?: number;
}

function totalFailed(report: Record<string, unknown>): number {
  let failed = 0;
  for (const value of Object.values(report)) {
    if (value && typeof value === "object" && "failed" in value) {
      const n = (value as EntityFailures).failed;
      if (typeof n === "number") failed += n;
    }
  }
  return failed;
}

export async function handler(
  event: SyncEvent | null,
): Promise<{ ok: boolean; failed: number; report: Record<string, unknown> }> {
  // Default to apply — the whole point of the scheduled invocation. A hard
  // failure (DB unreachable, sourceId abort) throws and fails the invocation;
  // per-record soft failures surface via `failed` so n8n can alert without the
  // run being considered a crash.
  const apply = event?.mode !== "dry-run";
  const report = await executeMigration({ apply });
  const failed = totalFailed(report);
  return { ok: failed === 0, failed, report };
}
