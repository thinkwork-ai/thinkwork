import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createGooglePlacesClient,
	loadGooglePlacesClientFromSsm,
	resetGooglePlacesClientCacheForTests,
	type PlaceDetailsResponse,
} from "../lib/wiki/google-places-client.js";

function mockOk(body: Partial<PlaceDetailsResponse>) {
	return new Response(JSON.stringify(body), { status: 200 });
}

function mock429({ quota = false }: { quota?: boolean } = {}) {
	const body = quota
		? JSON.stringify({
				error: {
					code: 429,
					message: "resource exhausted",
					status: "RESOURCE_EXHAUSTED",
				},
			})
		: JSON.stringify({ error: { code: 429, message: "rate limited" } });
	return new Response(body, { status: 429, statusText: "Too Many Requests" });
}

function mock500() {
	return new Response("boom", { status: 500, statusText: "Internal" });
}

function mock403() {
	return new Response("nope", { status: 403, statusText: "Forbidden" });
}

function mock404() {
	return new Response(
		JSON.stringify({
			error: { code: 404, status: "NOT_FOUND", message: "gone" },
		}),
		{ status: 404, statusText: "Not Found" },
	);
}

const silentLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

function silent() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

describe("createGooglePlacesClient", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects creation when apiKey is empty", () => {
		expect(() =>
			createGooglePlacesClient({ apiKey: "" }),
		).toThrow(/apiKey is required/);
	});

	it("returns typed object on 200", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			mockOk({
				id: "ChIJ123",
				displayName: { text: "Musée du Louvre" },
				formattedAddress: "Paris, France",
				addressComponents: [
					{
						longText: "Paris",
						shortText: "Paris",
						types: ["locality", "political"],
					},
					{
						longText: "France",
						shortText: "FR",
						types: ["country", "political"],
					},
				],
			}),
		);
		const client = createGooglePlacesClient({
			apiKey: "key",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			logger: silent(),
		});
		const res = await client.fetchPlaceDetails("ChIJ123");
		expect(res?.id).toBe("ChIJ123");
		expect(res?.addressComponents?.length).toBe(2);
		expect(client.breakerState().state).toBe("closed");
		expect(client.breakerState().consecutive_failures).toBe(0);

		// Verify FieldMask header was sent.
		const call = fetchImpl.mock.calls[0];
		const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
		expect(headers["X-Goog-FieldMask"]).toContain("addressComponents");
		expect(headers["X-Goog-Api-Key"]).toBe("key");
	});

	it("retries on 429 then succeeds", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(mock429())
			.mockResolvedValueOnce(mockOk({ id: "ChIJ" }));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			sleep,
			logger: silent(),
		});
		const res = await client.fetchPlaceDetails("ChIJ");
		expect(res?.id).toBe("ChIJ");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(client.breakerState().state).toBe("closed");
		// Success after retry should reset the failure counter.
		expect(client.breakerState().consecutive_failures).toBe(0);
	});

	it("retries on 5xx and gives up after maxRetries", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(mock500());
		const sleep = vi.fn().mockResolvedValue(undefined);
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			sleep,
			logger: silent(),
			maxRetries: 2,
			backoffMs: [1, 1, 1],
		});
		const res = await client.fetchPlaceDetails("ChIJ");
		expect(res).toBeNull();
		// initial + 2 retries = 3 attempts
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(client.breakerState().consecutive_failures).toBe(1);
	});

	it("trips the breaker on RESOURCE_EXHAUSTED immediately", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(mock429({ quota: true }));
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			logger: silent(),
		});
		const res = await client.fetchPlaceDetails("ChIJ");
		expect(res).toBeNull();
		const snap = client.breakerState();
		expect(snap.state).toBe("tripped");
		expect(snap.trip_reason).toContain("RESOURCE_EXHAUSTED");

		// Subsequent calls short-circuit without invoking fetch.
		const res2 = await client.fetchPlaceDetails("ChIJanother");
		expect(res2).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("trips the breaker after N consecutive non-retryable failures", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(mock403());
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			logger: silent(),
			breakerThreshold: 3,
			maxRetries: 0, // non-retryable 403 anyway
		});
		for (let i = 0; i < 3; i++) {
			await client.fetchPlaceDetails(`ChIJ${i}`);
		}
		expect(client.breakerState().state).toBe("tripped");
		expect(client.breakerState().trip_reason).toContain("3 consecutive");

		// Fourth call short-circuits.
		const before = fetchImpl.mock.calls.length;
		await client.fetchPlaceDetails("ChIJtrapped");
		expect(fetchImpl.mock.calls.length).toBe(before);
	});

	it("returns null on 404 without incrementing breaker counter", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(mock404());
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			logger: silent(),
			breakerThreshold: 2,
		});
		await client.fetchPlaceDetails("ChIJrotated");
		await client.fetchPlaceDetails("ChIJrotated2");
		await client.fetchPlaceDetails("ChIJrotated3");
		// Three NOT_FOUNDs should NOT trip the breaker.
		expect(client.breakerState().state).toBe("closed");
		expect(client.breakerState().consecutive_failures).toBe(0);
	});

	it("returns null for empty place_id without calling fetch", async () => {
		const fetchImpl = vi.fn();
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			logger: silent(),
		});
		expect(await client.fetchPlaceDetails("")).toBeNull();
		expect(await client.fetchPlaceDetails("  ")).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("retries on network errors", async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValueOnce(mockOk({ id: "ChIJ" }));
		const sleep = vi.fn().mockResolvedValue(undefined);
		const client = createGooglePlacesClient({
			apiKey: "k",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			sleep,
			logger: silent(),
		});
		const res = await client.fetchPlaceDetails("ChIJ");
		expect(res?.id).toBe("ChIJ");
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

describe("loadGooglePlacesClientFromSsm", () => {
	beforeEach(() => {
		resetGooglePlacesClientCacheForTests();
		delete process.env.GOOGLE_PLACES_SSM_PARAM_NAME;
	});

	it("returns null when no param name is configured", async () => {
		const client = await loadGooglePlacesClientFromSsm();
		expect(client).toBeNull();
	});

	it("initializes a client from a SSM-returned key", async () => {
		const ssmSend = vi.fn().mockResolvedValue("REAL-API-KEY");
		const client = await loadGooglePlacesClientFromSsm({
			paramName: "/thinkwork/dev/google-places/api-key",
			ssmSend,
		});
		expect(client).not.toBeNull();
		expect(ssmSend).toHaveBeenCalledWith(
			"/thinkwork/dev/google-places/api-key",
		);

		// Caches — second call returns same instance without re-invoking SSM.
		const client2 = await loadGooglePlacesClientFromSsm({
			paramName: "/thinkwork/dev/google-places/api-key",
			ssmSend,
		});
		expect(client2).toBe(client);
		expect(ssmSend).toHaveBeenCalledTimes(1);
	});

	it("returns null when SSM returns an empty string", async () => {
		const ssmSend = vi.fn().mockResolvedValue("");
		const client = await loadGooglePlacesClientFromSsm({
			paramName: "/thinkwork/dev/google-places/api-key",
			ssmSend,
		});
		expect(client).toBeNull();
	});

	it("returns null (not throws) when SSM fetch fails", async () => {
		const ssmSend = vi.fn().mockRejectedValue(new Error("access denied"));
		const client = await loadGooglePlacesClientFromSsm({
			paramName: "/thinkwork/dev/google-places/api-key",
			ssmSend,
		});
		expect(client).toBeNull();
	});
});
