import { gql } from "@urql/core";

/**
 * GraphQL queries the force-graph components own. Defined in this package
 * so admin and Spaces don't have to keep their own copies in sync. Plain
 * `gql` template literals (no codegen) — the components only need runtime
 * shape, and consumers either generate their own typed documents or use
 * the data shape exported by this package.
 */

export const MemoryGraphQuery = gql`
  query MemoryGraph($userId: ID, $allTenantBanks: Boolean) {
    memoryGraph(userId: $userId, allTenantBanks: $allTenantBanks) {
      nodes {
        id
        label
        type
        strategy
        entityType
        edgeCount
        latestThreadId
        bankId
        bankName
      }
      edges {
        source
        target
        type
        label
        weight
      }
      banks {
        id
        name
      }
    }
  }
`;
