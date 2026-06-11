import { getConfig, getAppsyncApiKey } from "@thinkwork/runtime-config";

/**
 * AppSync notify helper for eval run status updates.
 *
 * Mirrors the pattern in cost-recording.ts (notifyCostRecorded).
 * Subscribers wired via @aws_subscribe in subscriptions.graphql.
 */

function appsyncEndpoint(): string {
  return getConfig("APPSYNC_ENDPOINT", "");
}

const MUTATION = `
	mutation NotifyEvalRunUpdate(
		$runId: ID!
		$tenantId: ID!
		$agentId: ID
		$status: String!
		$totalTests: Int
		$passed: Int
		$failed: Int
		$passRate: Float
		$errorMessage: String
	) {
		notifyEvalRunUpdate(
			runId: $runId
			tenantId: $tenantId
			agentId: $agentId
			status: $status
			totalTests: $totalTests
			passed: $passed
			failed: $failed
			passRate: $passRate
			errorMessage: $errorMessage
		) {
			runId
			tenantId
			agentId
			status
			totalTests
			passed
			failed
			passRate
			errorMessage
			updatedAt
		}
	}
`;

export async function notifyEvalRunUpdate(payload: {
  runId: string;
  tenantId: string;
  agentId: string | null;
  status: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  passRate?: number;
  errorMessage?: string;
}): Promise<void> {
  const endpoint = appsyncEndpoint();
  const apiKey = getAppsyncApiKey();
  if (!endpoint || !apiKey) return;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ query: MUTATION, variables: payload }),
    });
    const body = await response.text();
    if (!response.ok || body.includes('"errors"')) {
      console.error(
        `[eval-notify] AppSync notifyEvalRunUpdate issue: ${response.status} ${body}`,
      );
    }
  } catch (err) {
    console.error(`[eval-notify] AppSync notifyEvalRunUpdate error:`, err);
  }
}
