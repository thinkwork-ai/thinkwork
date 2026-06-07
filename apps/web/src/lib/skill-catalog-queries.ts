import { graphql } from "@/gql";

// Typed graphql() operation for the composer skill picker (plan 2026-06-04-004
// U1/U5). Lives outside the legacy untyped `graphql-queries.ts` so it gets full
// type-safety from the generated documents.

export const TenantSkillCatalogQuery = graphql(`
  query TenantSkillCatalog($agentId: ID) {
    tenantSkillCatalog(agentId: $agentId) {
      slug
      displayName
      description
      icon
      installed
    }
  }
`);
