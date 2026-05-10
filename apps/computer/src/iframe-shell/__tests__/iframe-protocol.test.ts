/**
 * Tests for the parent <-> iframe-shell envelope protocol (plan-012 U9).
 *
 * Pin the load-bearing security invariants that U10 builds on:
 *   1. Inbound envelopes without the expected channelId are rejected.
 *   2. Inbound envelopes with the wrong shape are rejected.
 *   3. The ALLOWED_PARENT_ORIGINS allowlist must not contain "null"
 *      or "*" — `assertSafeAllowlist` throws if either is present.
 *   4. `assertNoSecretsInPayload` rejects payloads that include any
 *      known credential field name.
 *   5. `buildEnvelope` produces a freshly-minted msgId and embeds the
 *      passed channelId.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	IframePayloadSecretLeakError,
	assertNoSecretsInPayload,
	assertSafeAllowlist,
	buildEnvelope,
	newChannelId,
	newMsgId,
	resolveAllowedParentOrigins,
	resolveSandboxIframeSrc,
	validateInboundEnvelope,
} from "../iframe-protocol";

describe("envelope mint helpers", () => {
	it("newChannelId returns a 36-char UUID-ish string", () => {
		const id = newChannelId();
		expect(typeof id).toBe("string");
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("newMsgId returns distinct ids", () => {
		const a = newMsgId();
		const b = newMsgId();
		expect(a).not.toBe(b);
	});

	it("buildEnvelope embeds channelId, kind, payload, fresh msgId, and replyTo when given", () => {
		const channelId = "fixed-channel";
		const env = buildEnvelope("init", { tsx: "<App />", version: "0.1.0" }, channelId);
		expect(env.v).toBe(1);
		expect(env.kind).toBe("init");
		expect(env.channelId).toBe(channelId);
		expect(env.payload).toEqual({ tsx: "<App />", version: "0.1.0" });
		expect(typeof env.msgId).toBe("string");
		expect(env.replyTo).toBeUndefined();

		const ack = buildEnvelope(
			"state-read-ack",
			{ value: 42 },
			channelId,
			env.msgId,
		);
		expect(ack.replyTo).toBe(env.msgId);
	});
});

describe("validateInboundEnvelope — channelId + shape gate", () => {
	const expected = "channel-A";

	it("rejects envelopes with the wrong channelId", () => {
		const env = buildEnvelope("ready", { ready: true }, "channel-B");
		expect(validateInboundEnvelope(env, expected)).toBeNull();
	});

	it("accepts envelopes with the matching channelId", () => {
		const env = buildEnvelope("ready", { ready: true }, expected);
		expect(validateInboundEnvelope(env, expected)).not.toBeNull();
	});

	it("rejects non-object input", () => {
		expect(validateInboundEnvelope(null, expected)).toBeNull();
		expect(validateInboundEnvelope("not envelope", expected)).toBeNull();
		expect(validateInboundEnvelope(42, expected)).toBeNull();
	});

	it("rejects envelopes with the wrong version", () => {
		const env = { ...buildEnvelope("ready", {}, expected), v: 2 };
		expect(validateInboundEnvelope(env, expected)).toBeNull();
	});

	it("rejects unknown envelope kinds", () => {
		const env = {
			...buildEnvelope("ready", {}, expected),
			kind: "future-kind",
		};
		expect(validateInboundEnvelope(env, expected)).toBeNull();
	});

	it("rejects envelopes with non-string msgId or channelId", () => {
		const env = buildEnvelope("ready", {}, expected);
		expect(
			validateInboundEnvelope({ ...env, msgId: 42 }, expected),
		).toBeNull();
		expect(
			validateInboundEnvelope({ ...env, channelId: null }, expected),
		).toBeNull();
	});

	it("rejects envelopes whose replyTo is not a string when present", () => {
		const env = { ...buildEnvelope("ready", {}, expected), replyTo: 42 };
		expect(validateInboundEnvelope(env, expected)).toBeNull();
	});
});

describe("assertSafeAllowlist — null/* invariant", () => {
	it("throws when the allowlist contains 'null'", () => {
		expect(() =>
			assertSafeAllowlist(["https://thinkwork.ai", "null"]),
		).toThrow(/null/);
	});

	it("throws when the allowlist contains '*'", () => {
		expect(() =>
			assertSafeAllowlist(["https://thinkwork.ai", "*"]),
		).toThrow(/\*/);
	});

	it("accepts a fully-qualified concrete origin allowlist", () => {
		expect(() =>
			assertSafeAllowlist([
				"https://thinkwork.ai",
				"https://dev.thinkwork.ai",
			]),
		).not.toThrow();
	});

	it("accepts an empty allowlist (effectively disables iframe — that's the operator's choice)", () => {
		expect(() => assertSafeAllowlist([])).not.toThrow();
	});
});

describe("assertNoSecretsInPayload — no-secrets invariant", () => {
	it("rejects payloads with apiKey", () => {
		expect(() =>
			assertNoSecretsInPayload({ apiKey: "secret" }),
		).toThrow(IframePayloadSecretLeakError);
	});

	it("rejects payloads with cognitoJwt", () => {
		expect(() =>
			assertNoSecretsInPayload({ cognitoJwt: "ey..." }),
		).toThrow(IframePayloadSecretLeakError);
	});

	it("rejects payloads with tenantId or userId or principalId", () => {
		expect(() =>
			assertNoSecretsInPayload({ tenantId: "t" }),
		).toThrow(IframePayloadSecretLeakError);
		expect(() =>
			assertNoSecretsInPayload({ userId: "u" }),
		).toThrow(IframePayloadSecretLeakError);
		expect(() =>
			assertNoSecretsInPayload({ principalId: "p" }),
		).toThrow(IframePayloadSecretLeakError);
	});

	it("accepts safe payloads", () => {
		expect(() =>
			assertNoSecretsInPayload({
				tsx: "<App />",
				version: "0.1.0",
				themeOverrides: { "--color-primary": "#fff" },
			}),
		).not.toThrow();
	});

	it("does not throw on null / undefined / non-object inputs", () => {
		expect(() => assertNoSecretsInPayload(null)).not.toThrow();
		expect(() => assertNoSecretsInPayload(undefined)).not.toThrow();
		expect(() => assertNoSecretsInPayload("string")).not.toThrow();
	});
});

describe("resolveSandboxIframeSrc — Vitest test-fallback branch", () => {
	// Vite's `define` plugin does not run under Vitest, so the bare
	// identifier `__SANDBOX_IFRAME_SRC__` is genuinely undeclared and
	// `typeof __SANDBOX_IFRAME_SRC__` returns "undefined". The
	// resolver falls through to globalThis lookup so tests can stage
	// values without rebuilding. The build-time substitution path
	// itself is covered by build-define-smoke.test.ts.

	const originalSrc = (
		globalThis as { __SANDBOX_IFRAME_SRC__?: string }
	).__SANDBOX_IFRAME_SRC__;
	const originalOrigins = (
		globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
	).__ALLOWED_PARENT_ORIGINS__;

	afterEach(() => {
		if (originalSrc === undefined) {
			delete (globalThis as { __SANDBOX_IFRAME_SRC__?: string })
				.__SANDBOX_IFRAME_SRC__;
		} else {
			(globalThis as { __SANDBOX_IFRAME_SRC__?: string }).__SANDBOX_IFRAME_SRC__ =
				originalSrc;
		}
		if (originalOrigins === undefined) {
			delete (globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] })
				.__ALLOWED_PARENT_ORIGINS__;
		} else {
			(
				globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
			).__ALLOWED_PARENT_ORIGINS__ = originalOrigins;
		}
	});

	it("returns the production default when no override is staged", () => {
		delete (globalThis as { __SANDBOX_IFRAME_SRC__?: string })
			.__SANDBOX_IFRAME_SRC__;
		expect(resolveSandboxIframeSrc()).toBe(
			"https://sandbox.thinkwork.ai/iframe-shell.html",
		);
	});

	it("returns the staged URL from globalThis when set", () => {
		(globalThis as { __SANDBOX_IFRAME_SRC__?: string }).__SANDBOX_IFRAME_SRC__ =
			"https://sandbox.dev.thinkwork.test/iframe-shell.html";
		expect(resolveSandboxIframeSrc()).toBe(
			"https://sandbox.dev.thinkwork.test/iframe-shell.html",
		);
	});

	it("ignores empty-string globalThis overrides and falls back to default", () => {
		(globalThis as { __SANDBOX_IFRAME_SRC__?: string }).__SANDBOX_IFRAME_SRC__ =
			"";
		expect(resolveSandboxIframeSrc()).toBe(
			"https://sandbox.thinkwork.ai/iframe-shell.html",
		);
	});
});

describe("resolveAllowedParentOrigins — Vitest test-fallback branch", () => {
	const originalOrigins = (
		globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
	).__ALLOWED_PARENT_ORIGINS__;

	afterEach(() => {
		if (originalOrigins === undefined) {
			delete (globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] })
				.__ALLOWED_PARENT_ORIGINS__;
		} else {
			(
				globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
			).__ALLOWED_PARENT_ORIGINS__ = originalOrigins;
		}
	});

	it("returns the production default when no override is staged", () => {
		delete (globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] })
			.__ALLOWED_PARENT_ORIGINS__;
		expect(resolveAllowedParentOrigins()).toEqual([
			"https://thinkwork.ai",
		]);
	});

	it("returns the staged list from globalThis when set", () => {
		(
			globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
		).__ALLOWED_PARENT_ORIGINS__ = [
			"https://thinkwork.ai",
			"https://dev.thinkwork.ai",
		];
		expect(resolveAllowedParentOrigins()).toEqual([
			"https://thinkwork.ai",
			"https://dev.thinkwork.ai",
		]);
	});

	it("ignores empty array overrides and falls back to default", () => {
		(
			globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
		).__ALLOWED_PARENT_ORIGINS__ = [];
		expect(resolveAllowedParentOrigins()).toEqual([
			"https://thinkwork.ai",
		]);
	});
});
