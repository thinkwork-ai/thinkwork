import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const JSON_HEADERS = { "content-type": "application/json" };

export function slackStubResponse(
  _event: APIGatewayProxyEventV2,
  name: string,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 501,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      error: `${name} handler is not implemented yet`,
    }),
  };
}
