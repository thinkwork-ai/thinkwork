/**
 * POST /api/desktop/runtime-session
 *
 * Tombstone for retired desktop-local Pi runtime preparation. Old packaged
 * desktop clients receive a stable 410 instead of an ambiguous auth or prep
 * failure while all supported Pi execution uses managed AgentCore.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { desktopLocalExecutionRetired } from "../lib/desktop-local-retired.js";
import { error, handleCors } from "../lib/response.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  return desktopLocalExecutionRetired();
}
