import { graphql } from "@/gql";

/**
 * Mutation: queue a new compliance export. Returns the QUEUED job —
 * the runner Lambda transitions it through running → complete (or
 * failed) asynchronously. The Exports page polls every 3s on active
 * jobs to surface the transition.
 */
export const CreateComplianceExportMutation = graphql(`
  mutation CreateComplianceExport(
    $filter: ComplianceEventFilter!
    $format: ComplianceExportFormat!
  ) {
    createComplianceExport(filter: $filter, format: $format) {
      jobId
      tenantId
      requestedByActorId
      requestedAt
      status
      format
      filter
      s3Key
      presignedUrl
      presignedUrlExpiresAt
      jobError
      startedAt
      completedAt
    }
  }
`);

/**
 * Query: caller's recent export jobs (LIMIT 50, sorted requested_at
 * DESC). Operators see all tenants; non-operators are tenant-scoped
 * via requireComplianceReader on the resolver.
 */
export const ComplianceExportsQuery = graphql(`
  query ComplianceExports {
    complianceExports {
      jobId
      tenantId
      requestedByActorId
      requestedAt
      status
      format
      filter
      s3Key
      presignedUrl
      presignedUrlExpiresAt
      jobError
      startedAt
      completedAt
    }
  }
`);
