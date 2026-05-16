/**
 * eval-worker Lambda (inert substrate)
 *
 * U2 ships the SQS fan-out substrate before any dispatcher sends traffic to
 * this worker. The stub intentionally throws so accidental traffic is visible:
 * SQS retries the message, then redrives it to the eval fan-out DLQ and trips
 * the DLQ depth alarm. U3 swaps this body for the live per-case runner.
 */

export async function handler(event: unknown): Promise<never> {
	console.error("[eval-worker] inert stub invoked", {
		event,
		message: "U3 will replace this body with the live per-case evaluator.",
	});
	throw new Error("eval-worker inert stub: U3 ships the live per-case body");
}
