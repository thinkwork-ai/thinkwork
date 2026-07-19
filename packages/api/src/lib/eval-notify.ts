import { publishAppSyncMutation } from "./appsync-iam-publisher.js";

/**
 * AppSync notify helper for eval run status updates.
 *
 * Mirrors the pattern in cost-recording.ts (notifyCostRecorded).
 * Subscribers wired via @aws_subscribe in subscriptions.graphql.
 */

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
  await publishAppSyncMutation(MUTATION, payload);
}
