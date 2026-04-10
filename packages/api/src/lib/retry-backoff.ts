/**
 * Exponential backoff with jitter for retry scheduling (PRD-09 §9.2.3).
 */

/**
 * Returns the delay in seconds for a given retry attempt.
 * Uses exponential backoff with full jitter.
 *
 * @param attempt - 1-based retry attempt number
 * @param baseSeconds - base delay in seconds (default 10)
 * @param maxSeconds - maximum delay cap in seconds (default 300)
 */
export function getRetryDelay(
	attempt: number,
	baseSeconds = 10,
	maxSeconds = 300,
): number {
	const exponential = baseSeconds * Math.pow(2, attempt - 1);
	const capped = Math.min(exponential, maxSeconds);
	// Full jitter: random between 0 and capped
	return Math.floor(Math.random() * capped) + 1;
}
