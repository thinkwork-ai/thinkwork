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

export const OntologyGraphQuery = gql`
  query OntologySchemaGraph($tenantId: ID!) {
    ontologySchemaGraph(tenantId: $tenantId) {
      tenantId
      types {
        slug
        name
        instanceCount
        lifecycleStatus
      }
      relationships {
        slug
        name
        sourceTypeSlugs
        targetTypeSlugs
      }
      candidates {
        itemId
        changeSetId
        itemType
        slug
        proposedValue
        editedValue
        evidenceCount
        origin
        status
      }
    }
  }
`;

/**
 * Twin neighborhood (THINK-327 U3): AWSJSON envelope
 * `{ ok, results: [{ node, neighbors, edges }] }` of Neptune openCypher
 * nodes plus `{rel, sourceId, targetId}` edge triples.
 */
export const TwinNeighborsQuery = gql`
  query TwinNeighbors($tenantId: ID, $canonicalId: ID!, $depth: Int) {
    twinNeighbors(tenantId: $tenantId, canonicalId: $canonicalId, depth: $depth)
  }
`;

/**
 * Traversal ring aggregation:
 * `{ ok, results: [{ relationship, direction, targetType, count }] }`.
 */
export const TwinNeighborSummaryQuery = gql`
  query TwinNeighborSummary($tenantId: ID, $canonicalId: ID!) {
    twinNeighborSummary(tenantId: $tenantId, canonicalId: $canonicalId)
  }
`;

/**
 * One ordered traversal batch: `{ ok, results: [{ members, edges }] }` —
 * Neptune nodes plus `{rel, sourceId, targetId, props}` edge triples.
 */
export const TwinNeighborMembersQuery = gql`
  query TwinNeighborMembers(
    $tenantId: ID
    $canonicalId: ID!
    $relationship: String!
    $targetType: String!
    $direction: String
    $offset: Int
    $limit: Int
  ) {
    twinNeighborMembers(
      tenantId: $tenantId
      canonicalId: $canonicalId
      relationship: $relationship
      targetType: $targetType
      direction: $direction
      offset: $offset
      limit: $limit
    )
  }
`;

/** Type-level twin overview: `{ ok, results: [{ roots, neighbors, edges }] }`. */
export const TwinSubgraphQuery = gql`
  query TwinSubgraph(
    $tenantId: ID
    $entityType: String!
    $limit: Int
    $depth: Int
  ) {
    twinSubgraph(
      tenantId: $tenantId
      entityType: $entityType
      limit: $limit
      depth: $depth
    )
  }
`;

export const KnowledgeGraphQuery = gql`
  query KnowledgeGraph($tenantId: ID!, $threadId: ID, $runId: ID) {
    knowledgeGraphGraph(
      tenantId: $tenantId
      threadId: $threadId
      runId: $runId
    ) {
      nodes {
        id
        entityId
        label
        typeLabel
        ontologyTypeSlug
        groundingStatus
        provenanceStatus
        relationshipCount
        evidenceCount
      }
      edges {
        id
        relationshipId
        source
        target
        label
        ontologyTypeSlug
        groundingStatus
        provenanceStatus
        evidenceCount
      }
    }
  }
`;
