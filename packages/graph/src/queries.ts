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
