import { graphql } from "@/gql";

// Typed graphql() operations for the Knowledge Bases operator console. These
// live separately from the legacy untyped `graphql-queries.ts` (which codegen
// excludes) so the console gets full type-safety from the generated documents.

export const KnowledgeBasesListQuery = graphql(`
  query KnowledgeBasesList($tenantId: ID!) {
    knowledgeBases(tenantId: $tenantId) {
      id
      name
      description
      status
      documentCount
      lastSyncAt
    }
  }
`);

export const KnowledgeBaseDetailQuery = graphql(`
  query KnowledgeBaseDetail($id: ID!) {
    knowledgeBase(id: $id) {
      id
      tenantId
      name
      slug
      description
      embeddingModel
      chunkingStrategy
      chunkSizeTokens
      chunkOverlapPercent
      status
      awsKbId
      lastSyncAt
      lastSyncStatus
      documentCount
      errorMessage
    }
  }
`);

export const TestKnowledgeBaseRetrievalQuery = graphql(`
  query TestKnowledgeBaseRetrieval($id: ID!, $query: String!) {
    testKnowledgeBaseRetrieval(id: $id, query: $query) {
      status
      hits {
        snippet
        score
        source
      }
    }
  }
`);

export const CreateKnowledgeBaseMutation = graphql(`
  mutation CreateKnowledgeBase($input: CreateKnowledgeBaseInput!) {
    createKnowledgeBase(input: $input) {
      id
      name
      status
    }
  }
`);

export const UpdateKnowledgeBaseMutation = graphql(`
  mutation UpdateKnowledgeBase($id: ID!, $input: UpdateKnowledgeBaseInput!) {
    updateKnowledgeBase(id: $id, input: $input) {
      id
      name
      description
      chunkingStrategy
      chunkSizeTokens
      chunkOverlapPercent
      status
    }
  }
`);

export const SyncKnowledgeBaseMutation = graphql(`
  mutation SyncKnowledgeBase($id: ID!) {
    syncKnowledgeBase(id: $id) {
      id
      status
      lastSyncStatus
    }
  }
`);

export const RetryKnowledgeBaseMutation = graphql(`
  mutation RetryKnowledgeBase($id: ID!) {
    retryKnowledgeBase(id: $id) {
      id
      status
      errorMessage
    }
  }
`);

export const DeleteKnowledgeBaseMutation = graphql(`
  mutation DeleteKnowledgeBase($id: ID!) {
    deleteKnowledgeBase(id: $id)
  }
`);
