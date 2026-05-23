import { graphql } from "../../gql/index.js";

export const AgentTenantBySlugDoc = graphql(`
  query CliAgentTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);
