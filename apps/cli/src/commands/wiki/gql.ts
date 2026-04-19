import { graphql } from "../../gql/index.js";

export const TenantBySlugDoc = graphql(`
  query CliWikiTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
      name
    }
  }
`);

export const AllTenantAgentsForWikiDoc = graphql(`
  query CliAllTenantAgentsForWiki($tenantId: ID!) {
    allTenantAgents(tenantId: $tenantId, includeSystem: false, includeSubAgents: false) {
      id
      name
      slug
      type
      status
    }
  }
`);

export const CompileWikiNowDoc = graphql(`
  mutation CliCompileWikiNow($tenantId: ID!, $ownerId: ID!, $modelId: String) {
    compileWikiNow(tenantId: $tenantId, ownerId: $ownerId, modelId: $modelId) {
      id
      tenantId
      ownerId
      status
      trigger
      dedupeKey
      attempt
      createdAt
    }
  }
`);

export const ResetWikiCursorDoc = graphql(`
  mutation CliResetWikiCursor($tenantId: ID!, $ownerId: ID!, $force: Boolean) {
    resetWikiCursor(tenantId: $tenantId, ownerId: $ownerId, force: $force) {
      tenantId
      ownerId
      cursorCleared
      pagesArchived
    }
  }
`);

export const WikiCompileJobsDoc = graphql(`
  query CliWikiCompileJobs($tenantId: ID!, $ownerId: ID, $limit: Int) {
    wikiCompileJobs(tenantId: $tenantId, ownerId: $ownerId, limit: $limit) {
      id
      tenantId
      ownerId
      status
      trigger
      dedupeKey
      attempt
      claimedAt
      startedAt
      finishedAt
      error
      metrics
      createdAt
    }
  }
`);
