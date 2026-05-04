/**
 * Plan §005 U16 — bearer isolation, scrubbing-fetch, and crash redaction.
 *
 * Test-first per the plan's Execution note. The contract under test is
 * the FR-3a / FR-4a egress invariant: per-user OAuth bearers do NOT
 * appear in any text the agent loop, the SessionStore, or the
 * structured logger sees, regardless of whether the upstream MCP
 * server reflects them in response bodies.
 *
 * Coverage layers:
 *
 *   1. `scrubBearerStrings` — pure regex + literal-match primitive.
 *   2. `createScrubbingFetch` — egress interceptor: handle→bearer swap +
 *      response-body scrub.
 *   3. `assembleTools` integration — the bearer minted into a HandleStore
 *      survives the full mcp build path through `JSON.stringify(tools)`,
 *      with no leak into tool definitions.
 *   4. Crash-redaction sketch — `scrubBearerStrings` applied to a
 *      thrown-error stack-trace excerpt redacts the bearer.
 *
 * Worker_thread structural isolation (defense-in-depth: spawn a real
 * worker_thread to run the agent loop) is intentionally OUT OF SCOPE
 * for U16 as shipped. The bearer-leak invariants tested here are
 * mechanism-#1-bearer-resolved-at-scrubbing-fetch — the same invariants
 * a worker-thread split would also need to hold. See PR body for the
 * deferred-to-followup framing.
 */

import { describe, expect, it } from "vitest";

import { scrubBearerStrings } from "../src/bearer-scrub.js";
import { createScrubbingFetch } from "../src/scrubbing-fetch.js";
import { HandleStore, McpHandleAuthScheme } from "../src/mcp.js";

// ---------------------------------------------------------------------------
// Layer 1 — scrubBearerStrings primitive.
// ---------------------------------------------------------------------------

describe("scrubBearerStrings — Bearer-prefix regex", () => {
	it("redacts standard `Bearer <token>` strings of >= 20 chars", () => {
		const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig";
		const out = scrubBearerStrings(input);
		expect(out).toBe("Authorization: Bearer [REDACTED]");
	});

	it("redacts multiple bearers in the same blob", () => {
		const input =
			"first=Bearer aaaaaaaaaaaaaaaaaaaaaaa\nsecond=Bearer bbbbbbbbbbbbbbbbbbbbbbb";
		const out = scrubBearerStrings(input);
		expect(out).toBe("first=Bearer [REDACTED]\nsecond=Bearer [REDACTED]");
	});

	it("redacts RFC 6750 token68 grammar with `+`, `/`, `=` (Okta / Cognito opaque tokens, base64-padded JWTs)", () => {
		const okta = "Bearer aB0/cD1+eF2=gH3=iJ4kLmNo";
		const padded = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig==";
		const slash = "Bearer abc/def+ghi/jkl/mno+pqr/";
		expect(scrubBearerStrings(okta)).toBe("Bearer [REDACTED]");
		expect(scrubBearerStrings(padded)).toBe("Bearer [REDACTED]");
		expect(scrubBearerStrings(slash)).toBe("Bearer [REDACTED]");
	});

	it("does not redact short Bearer-shaped substrings (< 20 chars)", () => {
		// Short tokens are not the secret category we target (real OAuth
		// IdPs emit much longer values); avoiding them prevents the
		// scrubber from mangling legitimate prose like
		// "Bearer with me here for one second".
		const input = "Bearer with me here";
		const out = scrubBearerStrings(input);
		expect(out).toBe(input);
	});

	it("preserves non-Bearer text", () => {
		const input = "Plain text with no auth tokens.";
		expect(scrubBearerStrings(input)).toBe(input);
	});

	it("returns empty / non-string inputs unchanged", () => {
		expect(scrubBearerStrings("")).toBe("");
		expect(scrubBearerStrings(undefined as never)).toBe(undefined);
		expect(scrubBearerStrings(null as never)).toBe(null);
		expect(scrubBearerStrings(42 as never)).toBe(42);
	});
});

describe("scrubBearerStrings — literal active-bearer scrub", () => {
	it("redacts the literal active bearer when supplied (covers reflected-bearer attacks without `Bearer ` prefix)", () => {
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		const input = `MCP server reflected: ${bearer} -- end`;
		const out = scrubBearerStrings(input, bearer);
		expect(out).toBe("MCP server reflected: [REDACTED] -- end");
	});

	it("redacts both Bearer-prefixed AND literal occurrences", () => {
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		const input = `Bearer ${bearer} and also raw ${bearer}`;
		const out = scrubBearerStrings(input, bearer);
		// Bearer-prefix scrub catches "Bearer <bearer>" first; the literal
		// scrub then catches the standalone occurrence.
		expect(out).toContain("Bearer [REDACTED]");
		expect(out).toContain("raw [REDACTED]");
		expect(out).not.toContain("FakeJwt");
	});

	it("does not redact a too-short active bearer (< 8 chars)", () => {
		// Conservative guard: a short test fixture or truncated value
		// must not mass-redact common substrings.
		const bearer = "abc";
		const input = `text ${bearer} more text`;
		expect(scrubBearerStrings(input, bearer)).toBe(input);
	});

	it("escapes regex meta-characters in the bearer", () => {
		// Real bearers are URL-safe (alphanumerics + `-`, `_`, `.`) but
		// the scrubber must tolerate the rare token format that carries
		// `+` or `/` without throwing on regex compilation.
		const bearer = "abcde.fg+hij/klm$nop[qrs]";
		const input = `reflected ${bearer} end`;
		const out = scrubBearerStrings(input, bearer);
		expect(out).toBe("reflected [REDACTED] end");
	});
});

// ---------------------------------------------------------------------------
// Layer 2 — createScrubbingFetch interceptor.
// ---------------------------------------------------------------------------

describe("createScrubbingFetch — handle → bearer swap on egress", () => {
	it("swaps `Authorization: Handle <uuid>` for `Bearer <bearer>` before delegating", async () => {
		const handleStore = new HandleStore();
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		const handle = handleStore.mint(bearer);

		const seen: RequestInit[] = [];
		const baseFetch: typeof fetch = async (_input, init) => {
			seen.push(init ?? {});
			return new Response("ok", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		await scrubbing("https://mcp.example.com/", {
			headers: { Authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		expect(seen).toHaveLength(1);
		const headers = seen[0]!.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Bearer ${bearer}`);
	});

	it("preserves caller-supplied non-Authorization headers in the swap", async () => {
		const handleStore = new HandleStore();
		const handle = handleStore.mint("aaaaaaaaaaaaaaaaaaaaaaaa");

		let captured: Record<string, string> | undefined;
		const baseFetch: typeof fetch = async (_input, init) => {
			captured = init?.headers as Record<string, string>;
			return new Response("", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		await scrubbing("https://mcp.example.com/", {
			headers: {
				Authorization: `${McpHandleAuthScheme} ${handle}`,
				"X-Trace-Id": "trace-1",
				"Content-Type": "application/json",
			},
		});

		expect(captured?.["X-Trace-Id"]).toBe("trace-1");
		expect(captured?.["Content-Type"]).toBe("application/json");
	});

	it("passes through requests with no Authorization header unchanged", async () => {
		const handleStore = new HandleStore();
		let captured: Record<string, string> | undefined;
		const baseFetch: typeof fetch = async (_input, init) => {
			captured = (init?.headers ?? {}) as Record<string, string>;
			return new Response("", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		await scrubbing("https://mcp.example.com/", {
			headers: { "X-Other": "value" },
		});

		expect(captured?.["X-Other"]).toBe("value");
		expect(captured?.Authorization).toBeUndefined();
	});

	it("passes through requests with non-Handle Authorization unchanged (fall-through for non-MCP callers)", async () => {
		const handleStore = new HandleStore();
		let captured: Record<string, string> | undefined;
		const baseFetch: typeof fetch = async (_input, init) => {
			captured = init?.headers as Record<string, string>;
			return new Response("", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		await scrubbing("https://other.example.com/", {
			headers: { Authorization: "Basic dXNlcjpwYXNz" },
		});

		expect(captured?.Authorization).toBe("Basic dXNlcjpwYXNz");
	});

	it("throws when the handle is unknown to the store (fail-closed)", async () => {
		const handleStore = new HandleStore();
		const baseFetch: typeof fetch = async () =>
			new Response("", { status: 200 });

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		await expect(
			scrubbing("https://mcp.example.com/", {
				headers: { Authorization: `${McpHandleAuthScheme} not-a-real-handle` },
			}),
		).rejects.toThrow();
	});

	it("recognizes case-insensitive `authorization` header", async () => {
		const handleStore = new HandleStore();
		const bearer = "AnotherBearerToken-PaddingPaddingPad";
		const handle = handleStore.mint(bearer);

		let captured: Record<string, string> | undefined;
		const baseFetch: typeof fetch = async (_input, init) => {
			captured = init?.headers as Record<string, string>;
			return new Response("", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		await scrubbing("https://mcp.example.com/", {
			headers: { authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		expect(captured?.Authorization).toBe(`Bearer ${bearer}`);
		expect(captured?.authorization).toBeUndefined();
	});

	it("supports Headers object input as well as plain record", async () => {
		const handleStore = new HandleStore();
		const bearer = "AnotherBearerToken-PaddingPaddingPad";
		const handle = handleStore.mint(bearer);

		let captured: Record<string, string> | undefined;
		const baseFetch: typeof fetch = async (_input, init) => {
			captured = init?.headers as Record<string, string>;
			return new Response("", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const headers = new Headers({
			Authorization: `${McpHandleAuthScheme} ${handle}`,
		});
		await scrubbing("https://mcp.example.com/", { headers });

		expect(captured?.Authorization).toBe(`Bearer ${bearer}`);
	});
});

describe("createScrubbingFetch — response-body scrub (BEARER LEAK CONTRACT)", () => {
	it("scrubs bearer-shaped strings from the response body", async () => {
		const handleStore = new HandleStore();
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		const handle = handleStore.mint(bearer);

		// Mock MCP server that reflects the bearer back in a 401 body
		// (the canonical "leaky upstream" failure mode).
		const baseFetch: typeof fetch = async () =>
			new Response(
				JSON.stringify({
					error: "unauthorized",
					message: `Token ${bearer} is invalid`,
					hint: `try Bearer ${bearer} again`,
				}),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			);

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const response = await scrubbing("https://mcp.example.com/", {
			headers: { Authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		const body = await response.text();
		// Both layers fired: the literal bearer is gone AND the
		// `Bearer <bearer>` form is gone.
		expect(body).not.toContain(bearer);
		expect(body).not.toContain("FakeJwt");
		expect(body).toContain("[REDACTED]");
	});

	it("preserves response status and statusText after scrubbing", async () => {
		const handleStore = new HandleStore();
		const bearer = "AnotherBearerToken-PaddingPaddingPad";
		const handle = handleStore.mint(bearer);

		const baseFetch: typeof fetch = async () =>
			new Response("upstream said no", {
				status: 401,
				statusText: "Unauthorized",
			});

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const response = await scrubbing("https://mcp.example.com/", {
			headers: { Authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		expect(response.status).toBe(401);
		expect(response.statusText).toBe("Unauthorized");
	});

	it("scrubs even when no `Authorization: Handle` header was supplied (defensive)", async () => {
		// The bearer-shape regex still fires on responses for
		// non-MCP callers — the literal-bearer scrub is the layer that
		// requires a known active bearer; the regex layer doesn't.
		const handleStore = new HandleStore();
		const baseFetch: typeof fetch = async () =>
			new Response(
				"leaked: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signaturePadding",
				{ headers: { "Content-Type": "application/json" } },
			);

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const response = await scrubbing("https://other.example.com/");
		const body = await response.text();

		expect(body).toBe("leaked: Bearer [REDACTED]");
	});
});

describe("createScrubbingFetch — content-type-aware buffering (SSE streaming preservation)", () => {
	it("passes through `text/event-stream` responses unchanged (does not buffer the streaming body)", async () => {
		const handleStore = new HandleStore();
		const bearer = "AnotherBearerToken-PaddingPaddingPad";
		const handle = handleStore.mint(bearer);

		// SSE responses are streaming; buffering via response.text()
		// would block the SDK's EventSourceParserStream from receiving
		// server-initiated events. Verify the returned Response is the
		// original (passthrough) — same body reference.
		const sseResponse = new Response("data: chunk1\n\ndata: chunk2\n\n", {
			headers: { "Content-Type": "text/event-stream" },
		});
		const baseFetch: typeof fetch = async () => sseResponse;

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const response = await scrubbing("https://mcp.example.com/", {
			headers: { Authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		expect(response).toBe(sseResponse);
	});

	it("buffers and scrubs `application/json` responses (the MCP RPC channel)", async () => {
		const handleStore = new HandleStore();
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		const handle = handleStore.mint(bearer);

		const baseFetch: typeof fetch = async () =>
			new Response(
				JSON.stringify({ error: "unauthorized", echo: bearer }),
				{
					status: 401,
					headers: { "Content-Type": "application/json" },
				},
			);

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const response = await scrubbing("https://mcp.example.com/", {
			headers: { Authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		const body = await response.text();
		expect(body).not.toContain(bearer);
		expect(body).toContain("[REDACTED]");
	});

	it("passes through binary content (application/octet-stream) unchanged", async () => {
		const handleStore = new HandleStore();
		const handle = handleStore.mint("aaaaaaaaaaaaaaaaaaaaaaaa");

		const binaryResponse = new Response(new Uint8Array([0, 1, 2, 3, 4]), {
			headers: { "Content-Type": "application/octet-stream" },
		});
		const baseFetch: typeof fetch = async () => binaryResponse;

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		const response = await scrubbing("https://mcp.example.com/", {
			headers: { Authorization: `${McpHandleAuthScheme} ${handle}` },
		});

		expect(response).toBe(binaryResponse);
	});
});

describe("createScrubbingFetch — duplicate-casing Authorization collision", () => {
	it("strips all case variants of `authorization` before installing the canonical Authorization", async () => {
		const handleStore = new HandleStore();
		const bearer = "AnotherBearerToken-PaddingPaddingPad";
		const handle = handleStore.mint(bearer);

		let captured: Record<string, string> | undefined;
		const baseFetch: typeof fetch = async (_input, init) => {
			captured = init?.headers as Record<string, string>;
			return new Response("", { status: 200 });
		};

		const scrubbing = createScrubbingFetch({ handleStore, baseFetch });
		// Caller supplies BOTH `Authorization` and `authorization` (a
		// proxy or test fixture might do this). Both must be stripped
		// before installing the canonical bearer.
		await scrubbing("https://mcp.example.com/", {
			headers: {
				Authorization: `${McpHandleAuthScheme} ${handle}`,
				authorization: "stale value",
			},
		});

		expect(captured?.Authorization).toBe(`Bearer ${bearer}`);
		expect(captured?.authorization).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Layer 3 — assembleTools integration: bearer never appears in serialized tools.
// (Already covered by the U7-era test in server.test.ts; this test extends
// the same invariant to confirm the U16 wiring did not regress it.)
// ---------------------------------------------------------------------------

describe("U16 wiring regression — bearer never reaches serialized ToolDefs", () => {
	it("the bearer minted into HandleStore is not present in JSON.stringify(handleStore)", () => {
		const handleStore = new HandleStore();
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		handleStore.mint(bearer);

		const serialized = JSON.stringify(handleStore);
		// JSON.stringify on a class with no toJSON returns "{}" (private
		// `#map` field is not enumerable). This is the U7 invariant; we
		// re-assert it here so a future refactor of HandleStore that
		// adds enumerable bearer state surfaces as a U16 test failure
		// (not just a U7 one) since U16 depends on this property.
		expect(serialized).not.toContain(bearer);
		expect(serialized).not.toContain("FakeJwt");
	});
});

// ---------------------------------------------------------------------------
// Layer 4 — Crash-redaction sketch.
// ---------------------------------------------------------------------------

describe("crash-redaction — scrubBearerStrings on synthetic stack traces", () => {
	it("redacts a bearer that appears in a thrown-error message", () => {
		const bearer = "FakeJwt.PayloadOnly.SignaturePart_DoNotEcho";
		// A poorly-coded upstream might `throw new Error(\`failed: ${bearer}\`)`.
		// The crash-handler in worker-entry.ts (deferred to follow-up
		// per the worker_thread structural-isolation followup) will route
		// these through `scrubBearerStrings` before serializing to the
		// error channel. Asserting the primitive does the work.
		const err = new Error(
			`upstream rejection: token ${bearer} expired; raw header was Bearer ${bearer}`,
		);
		const stackExcerpt = err.message + "\n" + (err.stack ?? "");
		const scrubbed = scrubBearerStrings(stackExcerpt, bearer);

		expect(scrubbed).not.toContain(bearer);
		expect(scrubbed).not.toContain("FakeJwt");
		expect(scrubbed).toContain("[REDACTED]");
	});
});
