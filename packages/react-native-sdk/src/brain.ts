import { getAuthToken } from "./graphql/token";

export type BrainEnrichmentSourceFamily = "BRAIN" | "WEB" | "KNOWLEDGE_BASE";

export interface BrainEnrichmentProposal {
  id: string;
  tenantId: string;
  targetPageTable: string;
  targetPageId: string;
  threadId: string;
  reviewRunId: string;
  reviewObjectKey: string;
  status: string;
  title: string;
  candidates: Array<{
    id: string;
    title: string;
    summary: string;
    sourceFamily: BrainEnrichmentSourceFamily;
    providerId: string;
    score?: number | null;
    citation?: {
      label?: string | null;
      uri?: string | null;
      sourceId?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
  }>;
  providerStatuses: Array<{
    providerId: string;
    family: string;
    sourceFamily?: string | null;
    displayName: string;
    state: string;
    reason?: string | null;
    error?: string | null;
    hitCount?: number | null;
    durationMs?: number | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface BrainEnrichmentSourceAvailability {
  family: BrainEnrichmentSourceFamily;
  label: string;
  available: boolean;
  selectedByDefault: boolean;
  reason?: string | null;
}

export async function listBrainEnrichmentSources(args: {
  graphqlUrl: string;
  input: {
    tenantId: string;
    pageTable: "wiki_pages" | "tenant_entity_pages";
    pageId: string;
  };
}): Promise<BrainEnrichmentSourceAvailability[]> {
  const data = await brainGraphql<{
    brainEnrichmentSources: BrainEnrichmentSourceAvailability[];
  }>(args.graphqlUrl, {
    query: `
      query BrainEnrichmentSources($tenantId: ID!, $pageTable: String!, $pageId: ID!) {
        brainEnrichmentSources(tenantId: $tenantId, pageTable: $pageTable, pageId: $pageId) {
          family
          label
          available
          selectedByDefault
          reason
        }
      }
    `,
    variables: args.input,
  });
  return data.brainEnrichmentSources;
}

export async function runBrainPageEnrichment(args: {
  graphqlUrl: string;
  input: {
    tenantId: string;
    pageTable: "wiki_pages" | "tenant_entity_pages";
    pageId: string;
    query?: string;
    sourceFamilies?: BrainEnrichmentSourceFamily[];
    limit?: number;
  };
}): Promise<BrainEnrichmentProposal> {
  const data = await brainGraphql<{
    runBrainPageEnrichment: BrainEnrichmentProposal;
  }>(args.graphqlUrl, {
    query: `
      mutation RunBrainPageEnrichment($input: RunBrainPageEnrichmentInput!) {
        runBrainPageEnrichment(input: $input) {
          id
          tenantId
          targetPageTable
          targetPageId
          threadId
          reviewRunId
          reviewObjectKey
          status
          title
          candidates {
            id
            title
            summary
            sourceFamily
            providerId
            score
            citation {
              label
              uri
              sourceId
              metadata
            }
          }
          providerStatuses {
            providerId
            family
            sourceFamily
            displayName
            state
            reason
            error
            hitCount
            durationMs
          }
          createdAt
          updatedAt
        }
      }
    `,
    variables: { input: args.input },
  });
  return data.runBrainPageEnrichment;
}

export async function acceptBrainEnrichmentReview(args: {
  graphqlUrl: string;
  reviewRunId: string;
  responseMarkdown: string;
  notes?: string;
}) {
  return brainGraphql(args.graphqlUrl, {
    query: `
      mutation AcceptBrainEnrichmentReview($runId: ID!, $input: AgentWorkspaceReviewDecisionInput) {
        acceptAgentWorkspaceReview(runId: $runId, input: $input) {
          id
          status
          updatedAt
        }
      }
    `,
    variables: {
      runId: args.reviewRunId,
      input: {
        responseMarkdown: args.responseMarkdown,
        notes: args.notes,
      },
    },
  });
}

export async function cancelBrainEnrichmentReview(args: {
  graphqlUrl: string;
  reviewRunId: string;
  responseMarkdown?: string;
  notes?: string;
}) {
  return brainGraphql(args.graphqlUrl, {
    query: `
      mutation CancelBrainEnrichmentReview($runId: ID!, $input: AgentWorkspaceReviewDecisionInput) {
        cancelAgentWorkspaceReview(runId: $runId, input: $input) {
          id
          status
          updatedAt
        }
      }
    `,
    variables: {
      runId: args.reviewRunId,
      input: {
        responseMarkdown: args.responseMarkdown,
        notes: args.notes,
      },
    },
  });
}

export async function editTenantEntityFact(args: {
  graphqlUrl: string;
  factId: string;
  content: string;
}) {
  return brainGraphql(args.graphqlUrl, {
    query:
      "mutation EditTenantEntityFact($factId: ID!, $content: String!) { editTenantEntityFact(factId: $factId, content: $content) { id bodyMd updatedAt } }",
    variables: { factId: args.factId, content: args.content },
  });
}

export async function rejectTenantEntityFact(args: {
  graphqlUrl: string;
  factId: string;
  reason?: string;
}) {
  return brainGraphql(args.graphqlUrl, {
    query:
      "mutation RejectTenantEntityFact($factId: ID!, $reason: String) { rejectTenantEntityFact(factId: $factId, reason: $reason) { id status updatedAt } }",
    variables: { factId: args.factId, reason: args.reason },
  });
}

async function brainGraphql<T = Record<string, unknown>>(
  graphqlUrl: string,
  body: { query: string; variables: Record<string, unknown> },
): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error("Not authenticated");
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: token,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      payload.errors?.[0]?.message || `GraphQL HTTP ${response.status}`,
    );
  }
  return payload.data as T;
}
