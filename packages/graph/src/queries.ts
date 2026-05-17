import { gql } from "@urql/core";

/**
 * GraphQL queries the force-graph components own. Defined in this package
 * so admin and computer don't have to keep their own copies in sync. Plain
 * `gql` template literals (no codegen) — the components only need runtime
 * shape, and consumers either generate their own typed documents or use
 * the data shape exported by this package.
 */

export const MemoryGraphQuery = gql`
  query MemoryGraph($userId: ID) {
    memoryGraph(userId: $userId) {
      nodes {
        id
        label
        type
        strategy
        entityType
        edgeCount
        latestThreadId
      }
      edges {
        source
        target
        type
        label
        weight
      }
    }
  }
`;

export const WikiGraphQuery = gql`
  query WikiGraph($tenantId: ID!, $userId: ID) {
    wikiGraph(tenantId: $tenantId, userId: $userId) {
      nodes {
        id
        label
        type
        entityType
        slug
        strategy
        edgeCount
        latestThreadId
      }
      edges {
        source
        target
        label
        weight
      }
    }
  }
`;
