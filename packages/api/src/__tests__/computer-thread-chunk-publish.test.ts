import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	vi.resetModules();
	process.env = {
		...ORIGINAL_ENV,
		APPSYNC_ENDPOINT: "https://example.appsync-api.us-east-1.amazonaws.com/graphql",
		APPSYNC_API_KEY: "test-key",
	};
});

afterEach(() => {
	vi.unstubAllGlobals();
	process.env = { ...ORIGINAL_ENV };
});

describe("publishComputerThreadChunk", () => {
	it("posts the AppSync mutation with a JSON chunk payload", async () => {
			const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
					data: {
						publishComputerThreadChunk: {
							threadId: "thread-1",
							chunk: JSON.stringify({ text: "hello" }),
							seq: 1,
							publishedAt: "2026-05-08T22:00:00.000Z",
						},
					},
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { publishComputerThreadChunk } = await import("../graphql/notify.js");

		await publishComputerThreadChunk({
			threadId: "thread-1",
			chunk: { text: "hello" },
			seq: 1,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
			const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
		expect(init.headers).toEqual({
			"Content-Type": "application/json",
			"x-api-key": "test-key",
		});
		const body = JSON.parse(String(init.body));
		expect(body.query).toContain("publishComputerThreadChunk");
		expect(body.variables).toEqual({
			threadId: "thread-1",
			chunk: JSON.stringify({ text: "hello" }),
			seq: 1,
		});
	});

	it("does not post when AppSync is not configured", async () => {
		process.env.APPSYNC_ENDPOINT = "";
		process.env.APPSYNC_API_KEY = "";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const { publishComputerThreadChunk } = await import("../graphql/notify.js");

		await publishComputerThreadChunk({
			threadId: "thread-1",
			chunk: { text: "hello" },
			seq: 1,
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
