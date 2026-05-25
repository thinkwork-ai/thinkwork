import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

/**
 * Slack slash-command ingress is inert until Spaces-based Slack
 * ingestion ships. See packages/api/src/handlers/slack/events.ts.
 */
export async function handler(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text: "Slack commands are temporarily disabled.",
    }),
  };
}
