/**
 * Read-side snapshot of one managed-application deployment job + its latest
 * event (plan 2026-06-12-001 U11).
 *
 * Single definition shared by the plugin engine store port (read-time
 * reconciliation of infrastructure components) and the infra component
 * handler (job reuse / fresh-job decisions). Read-only — all writes go
 * through the deployment mutations / shared plan-job core.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  managedApplicationDeploymentEvents,
  managedApplicationDeploymentJobs,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../graphql/utils.js";

type DbLike = typeof defaultDb;

/**
 * Deployment-job status vocabulary the reconciler maps from:
 * planning → awaiting_approval → applying → succeeded | failed, plus
 * rejected (admin rejection of the plan).
 */
export interface PluginDeploymentJobSnapshot {
  id: string;
  status: string;
  operation: string;
  appKey: string;
  applicationId: string | null;
  errorMessage: string | null;
  evidenceBucket: string | null;
  evidencePrefix: string | null;
  latestEvent: {
    eventType: string;
    message: string;
    createdAt: Date;
  } | null;
}

export async function readDeploymentJobSnapshot(
  tenantId: string,
  jobId: string,
  db: DbLike = defaultDb,
): Promise<PluginDeploymentJobSnapshot | null> {
  const [job] = await db
    .select()
    .from(managedApplicationDeploymentJobs)
    .where(
      and(
        eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
        eq(managedApplicationDeploymentJobs.id, jobId),
      ),
    )
    .limit(1);
  if (!job) return null;

  const [latest] = await db
    .select()
    .from(managedApplicationDeploymentEvents)
    .where(
      and(
        eq(managedApplicationDeploymentEvents.tenant_id, tenantId),
        eq(managedApplicationDeploymentEvents.job_id, jobId),
      ),
    )
    .orderBy(desc(managedApplicationDeploymentEvents.created_at))
    .limit(1);

  return {
    id: job.id,
    status: job.status,
    operation: job.operation,
    appKey: job.app_key,
    applicationId: job.application_id,
    errorMessage: job.error_message,
    evidenceBucket: job.evidence_bucket,
    evidencePrefix: job.evidence_prefix,
    latestEvent: latest
      ? {
          eventType: latest.event_type,
          message: latest.message,
          createdAt: latest.created_at,
        }
      : null,
  };
}
