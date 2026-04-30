import { getAuthToken } from "./graphql/token";

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

async function brainGraphql(
  graphqlUrl: string,
  body: { query: string; variables: Record<string, unknown> },
) {
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
    throw new Error(payload.errors?.[0]?.message || `GraphQL HTTP ${response.status}`);
  }
  return payload.data;
}
