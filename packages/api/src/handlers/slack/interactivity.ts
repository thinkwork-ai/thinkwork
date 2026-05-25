import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

/**
 * Slack interactivity callbacks (modal submissions, message actions) are
 * inert until Spaces-based Slack ingestion ships. See
 * packages/api/src/handlers/slack/events.ts for the full reasoning.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true, ignored: "slack-interactivity inert" }),
  };
}
