import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

/**
 * Slack events ingress is currently inert. The previous implementation
 * routed inbound events into the legacy Computer task queue
 * (`computer_tasks`). With Computer removed in the kill-Computer sweep,
 * ingestion needs a new substrate (Spaces + tenant platform agent) and
 * lives behind a follow-up brainstorm.
 *
 * Responding 200 OK keeps Slack's retry queue happy while we stand the
 * new path up; events are accepted-and-dropped rather than retried.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, ignored: "slack-events inert" }),
  };
}
