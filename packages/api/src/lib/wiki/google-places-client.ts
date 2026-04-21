/**
 * Google Places API (New) client — narrow wrapper around the Place Details
 * endpoint.
 *
 * Only the one endpoint we need. Raw `fetch` (native in the Lambda Node 20+
 * runtime) with typed responses, retry-with-backoff on transient failures,
 * and an in-process circuit breaker that trips after N consecutive failures
 * OR any `RESOURCE_EXHAUSTED` response. Breaker state is per-client-instance
 * and resets when a new instance is constructed (e.g., at Lambda cold start).
 *
 * See:
 *   - https://developers.google.com/maps/documentation/places/web-service/place-details
 *   - docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md §Unit 4
 *
 * Response field names follow Places API (New) — camelCase (`longText`,
 * `shortText`, `addressComponents`), NOT the legacy `long_name` / `short_name`
 * shape. Callers that walk addressComponents must use the New names.
 */

export interface AddressComponent {
	longText: string;
	shortText: string;
	types: string[];
	languageCode?: string;
}

export interface PlaceDetailsResponse {
	id: string;
	displayName?: { text?: string; languageCode?: string };
	formattedAddress?: string;
	addressComponents?: AddressComponent[];
	types?: string[];
	location?: { latitude: number; longitude: number };
}

export interface GooglePlacesClient {
	fetchPlaceDetails(placeId: string): Promise<PlaceDetailsResponse | null>;
	breakerState(): BreakerSnapshot;
}

export type BreakerState = "closed" | "tripped";

export interface BreakerSnapshot {
	state: BreakerState;
	consecutive_failures: number;
	trip_reason: string | null;
}

export interface CreateClientOptions {
	apiKey: string;
	logger?: Pick<Console, "warn" | "error" | "info">;
	/**
	 * Injection seam for tests. Defaults to global fetch.
	 */
	fetchImpl?: typeof fetch;
	/**
	 * Injection seam for tests. Defaults to setTimeout-backed sleep.
	 */
	sleep?: (ms: number) => Promise<void>;
	/**
	 * Number of consecutive non-retryable + retry-exhausted failures before
	 * the breaker trips. Default 5 per plan R11.
	 */
	breakerThreshold?: number;
	/**
	 * Max retry attempts per call (excluding the initial attempt). Default 3.
	 */
	maxRetries?: number;
	/**
	 * Backoff milliseconds per retry attempt. Default [500, 1000, 2000, 4000].
	 * The first element is used before attempt 2, the second before attempt 3,
	 * etc.
	 */
	backoffMs?: number[];
}

const PLACES_API_BASE = "https://places.googleapis.com/v1/places";
const FIELD_MASK =
	"id,displayName,formattedAddress,addressComponents,types,location";

export function createGooglePlacesClient(
	opts: CreateClientOptions,
): GooglePlacesClient {
	if (!opts.apiKey || opts.apiKey.trim().length === 0) {
		throw new Error(
			"createGooglePlacesClient: apiKey is required (got empty string)",
		);
	}

	const fetchImpl = opts.fetchImpl ?? fetch;
	const sleep = opts.sleep ?? defaultSleep;
	const breakerThreshold = opts.breakerThreshold ?? 5;
	const maxRetries = opts.maxRetries ?? 3;
	const backoffMs = opts.backoffMs ?? [500, 1000, 2000, 4000];
	const logger = opts.logger ?? console;

	let consecutiveFailures = 0;
	let state: BreakerState = "closed";
	let tripReason: string | null = null;

	function tripBreaker(reason: string) {
		if (state === "tripped") return;
		state = "tripped";
		tripReason = reason;
		logger.warn(
			`[google-places] breaker tripped: ${reason}` +
				` (consecutive_failures=${consecutiveFailures})`,
		);
	}

	function recordSuccess() {
		consecutiveFailures = 0;
	}

	function recordFailure(reason: string) {
		consecutiveFailures += 1;
		if (consecutiveFailures >= breakerThreshold) {
			tripBreaker(`${breakerThreshold} consecutive failures: ${reason}`);
		}
	}

	async function fetchPlaceDetails(
		placeId: string,
	): Promise<PlaceDetailsResponse | null> {
		if (state === "tripped") return null;
		if (!placeId || placeId.trim().length === 0) return null;

		const url = `${PLACES_API_BASE}/${encodeURIComponent(placeId)}?languageCode=en`;
		const headers = {
			"X-Goog-Api-Key": opts.apiKey,
			"X-Goog-FieldMask": FIELD_MASK,
			"Content-Type": "application/json",
		};

		let lastError: string | null = null;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const res = await fetchImpl(url, { method: "GET", headers });
				if (res.status === 200) {
					const body = (await res.json()) as PlaceDetailsResponse;
					recordSuccess();
					return body;
				}

				// NOT_FOUND — place_id was valid-shaped but Google has no (or
				// deprecated) record for it. Return null, do NOT trip the
				// breaker: this is a known, rare, upstream state, not a
				// failure of the client.
				if (res.status === 404) {
					logger.warn(
						`[google-places] not_found: place_id=${placeId}`,
					);
					return null;
				}

				// Quota exhausted — trip the breaker immediately per R11.
				if (res.status === 429) {
					const body = await safeReadBody(res);
					if (body?.includes("RESOURCE_EXHAUSTED")) {
						tripBreaker("RESOURCE_EXHAUSTED (quota exceeded)");
						return null;
					}
					// Regular 429 — retryable.
					lastError = `429 rate_limited`;
					if (attempt < maxRetries) {
						await sleep(backoffMs[attempt] ?? 4000);
						continue;
					}
					recordFailure(lastError);
					return null;
				}

				// 5xx — retryable.
				if (res.status >= 500) {
					lastError = `${res.status}`;
					if (attempt < maxRetries) {
						await sleep(backoffMs[attempt] ?? 4000);
						continue;
					}
					recordFailure(lastError);
					return null;
				}

				// 4xx other than 429/404 — non-retryable (bad FieldMask,
				// revoked key, referrer restriction, etc.). Failure.
				lastError = `${res.status} ${res.statusText}`;
				logger.error(
					`[google-places] non_retryable_error: ${lastError} place_id=${placeId}`,
				);
				recordFailure(lastError);
				return null;
			} catch (err) {
				// Network / DNS / fetch throws — treat as retryable.
				lastError = (err as Error)?.message || String(err);
				if (attempt < maxRetries) {
					await sleep(backoffMs[attempt] ?? 4000);
					continue;
				}
				recordFailure(`network_error: ${lastError}`);
				return null;
			}
		}

		recordFailure(lastError ?? "unknown");
		return null;
	}

	function breakerState(): BreakerSnapshot {
		return {
			state,
			consecutive_failures: consecutiveFailures,
			trip_reason: tripReason,
		};
	}

	return { fetchPlaceDetails, breakerState };
}

async function safeReadBody(res: Response): Promise<string | null> {
	try {
		return await res.text();
	} catch {
		return null;
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// SSM loader — for Lambda init paths.
// ---------------------------------------------------------------------------

let cachedClient: GooglePlacesClient | null = null;

export interface SsmLoaderOptions {
	/**
	 * SSM parameter name. Typically `/thinkwork/<stage>/google-places/api-key`.
	 * Read from env `GOOGLE_PLACES_SSM_PARAM_NAME` when not passed.
	 */
	paramName?: string;
	/**
	 * Override for tests.
	 */
	ssmSend?: (paramName: string) => Promise<string | null>;
}

/**
 * Lazy-load a GooglePlacesClient from SSM SecureString. Caches the client at
 * module scope so warm Lambda invocations don't pay for SSM + KMS on every
 * call. Returns null (with a warn log) if the parameter is missing or the
 * lookup fails — the caller should treat null as "no Google support this
 * run" and proceed with metadata-only place rows.
 */
export async function loadGooglePlacesClientFromSsm(
	opts: SsmLoaderOptions = {},
): Promise<GooglePlacesClient | null> {
	if (cachedClient) return cachedClient;

	const paramName =
		opts.paramName ?? process.env.GOOGLE_PLACES_SSM_PARAM_NAME;
	if (!paramName) {
		console.warn(
			"[google-places] no SSM param name configured (GOOGLE_PLACES_SSM_PARAM_NAME unset) — skipping client init",
		);
		return null;
	}

	try {
		const apiKey = opts.ssmSend
			? await opts.ssmSend(paramName)
			: await defaultSsmSend(paramName);
		if (!apiKey || apiKey.trim().length === 0) {
			console.warn(
				`[google-places] SSM param ${paramName} is empty — skipping client init`,
			);
			return null;
		}
		cachedClient = createGooglePlacesClient({ apiKey });
		console.info(`[google-places] client initialized from ${paramName}`);
		return cachedClient;
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		console.warn(
			`[google-places] failed to load SSM param ${paramName}: ${msg} — skipping client init`,
		);
		return null;
	}
}

/**
 * Clear the cached client — test-only; real Lambdas never call this.
 */
export function resetGooglePlacesClientCacheForTests(): void {
	cachedClient = null;
}

async function defaultSsmSend(paramName: string): Promise<string | null> {
	const { SSMClient, GetParameterCommand } = await import(
		"@aws-sdk/client-ssm"
	);
	const ssm = new SSMClient({});
	const res = await ssm.send(
		new GetParameterCommand({ Name: paramName, WithDecryption: true }),
	);
	return res.Parameter?.Value ?? null;
}
