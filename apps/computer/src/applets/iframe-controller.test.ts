/**
 * Tests for IframeAppletController (plan-012 U10).
 *
 * Pin the load-bearing security invariants in JSDOM (no real iframe
 * execution; that's the Playwright smoke at U10 deploy time):
 *   1. Outbound postMessage uses `targetOrigin: "*"`. A regression test
 *      fails the build if any code path passes a concrete origin.
 *   2. Inbound source-identity gate: only messages from the iframe's
 *      own contentWindow are accepted; sibling iframes / windows are
 *      dropped silently.
 *   3. Channel nonce gate: envelopes with the wrong channelId are
 *      dropped silently.
 *   4. No-secrets-in-payload: any envelope containing a known credential
 *      field name throws IframePayloadSecretLeakError.
 *   5. Init handshake: parent posts `init` only after iframe `ready`.
 *   6. State proxy: state-read / state-write round-trip through the
 *      parent's GraphQL handlers; the iframe never sees raw credentials.
 *   7. dispose() unsubscribes the message listener and rejects pending
 *      requests.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IframeAppletController } from "./iframe-controller";
import { buildEnvelope, IframePayloadSecretLeakError } from "@/iframe-shell/iframe-protocol";

interface PostMessageCall {
	envelope: unknown;
	targetOrigin: string;
	transfer: Transferable[];
}

function createController(opts?: {
	getState?: (key: string) => Promise<unknown>;
	setState?: (key: string, value: unknown) => Promise<void>;
	onCallback?: (name: string, payload: unknown) => void;
	onError?: (err: { code: string; message: string }) => void;
	srcOverride?: string;
}) {
	const calls: PostMessageCall[] = [];
	// Build a fake contentWindow that records every postMessage call.
	const fakeWindow = {
		postMessage: (envelope: unknown, targetOrigin: string, transfer?: Transferable[]) => {
			calls.push({
				envelope,
				targetOrigin,
				transfer: transfer ?? [],
			});
		},
	} as unknown as Window;

	const controller = new IframeAppletController({
		tsx: "<App />",
		version: "0.1.0",
		srcOverride: opts?.srcOverride ?? "https://sandbox.test/iframe-shell.html",
		sourceWindowOverride: fakeWindow,
		...opts,
	});

	// JSDOM doesn't load the iframe src so contentWindow is null. Fake
	// it via the override path (see IframeControllerOptions).
	Object.defineProperty(controller.element, "contentWindow", {
		value: fakeWindow,
		configurable: true,
	});

	return { controller, calls, fakeWindow };
}

function postFromIframe(
	controller: IframeAppletController,
	fakeWindow: Window,
	kind: Parameters<typeof buildEnvelope>[0],
	payload: unknown,
	replyTo?: string,
) {
	const envelope = buildEnvelope(
		kind,
		payload,
		controller.channelId,
		replyTo,
	);
	window.dispatchEvent(
		new MessageEvent("message", {
			data: envelope,
			source: fakeWindow,
		}),
	);
	return envelope;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("IframeAppletController — element + handshake", () => {
	it("creates a sandbox iframe with allow-scripts ONLY (no allow-same-origin)", () => {
		const { controller } = createController();
		const sandboxAttr = controller.element.getAttribute("sandbox") ?? "";
		const tokens = sandboxAttr.split(/\s+/).filter(Boolean);
		expect(tokens).toContain("allow-scripts");
		expect(tokens).not.toContain("allow-same-origin");
	});

	it("pins the iframe src at construction and never reassigns it", () => {
		const { controller } = createController({
			srcOverride: "https://sandbox.test/iframe-shell.html",
		});
		expect(controller.element.src).toBe(
			"https://sandbox.test/iframe-shell.html",
		);
		const initial = controller.element.src;
		// Simulate a malicious caller trying to repoint the iframe.
		// (Not enforced by the controller — but our test asserts that
		// nothing in the controller's normal flow mutates src.)
		controller.applyTheme({ "--accent": "#fff" });
		expect(controller.element.src).toBe(initial);
	});

	it("posts init on iframe `load` (resolves the chicken-and-egg without iframe knowing channelId)", () => {
		const { controller, calls } = createController();

		// Before load, no init has been posted.
		expect(
			calls.find((c) => (c.envelope as { kind?: string }).kind === "init"),
		).toBeUndefined();

		// Simulate the iframe's DOM `load` event. The controller posts
		// init unconditionally on load — the iframe-shell's message
		// listener captures our channelId from this very envelope.
		controller.element.dispatchEvent(new Event("load"));

		const init = calls.find(
			(c) => (c.envelope as { kind?: string }).kind === "init",
		);
		expect(init).toBeDefined();
		expect(
			(init!.envelope as { payload: { tsx: string } }).payload.tsx,
		).toBe("<App />");
	});

	it("re-posts init defensively on iframe `ready` envelope (legacy/forward-compat)", () => {
		const { controller, calls, fakeWindow } = createController();
		// Skip `load` to isolate this path. A theoretical iframe-shell
		// that does send `ready` first should still work.
		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		const init = calls.find(
			(c) => (c.envelope as { kind?: string }).kind === "init",
		);
		expect(init).toBeDefined();
	});

	it("ready promise resolves on `ready-with-component`", async () => {
		const { controller, fakeWindow } = createController();

		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		postFromIframe(controller, fakeWindow, "ready-with-component", {
			rendered: true,
			renderedAt: new Date().toISOString(),
		});

		await expect(controller.ready).resolves.toBeUndefined();
		expect(controller.element.getAttribute("data-ready")).toBe("true");
		expect(controller.statusValue).toBe("ready");
	});

	it("ready promise rejects on `error` envelope", async () => {
		const { controller, fakeWindow } = createController();
		postFromIframe(controller, fakeWindow, "error", {
			code: "IMPORT_REJECTED",
			message: "lodash is not allowed",
		});
		await expect(controller.ready).rejects.toThrow(/iframe init failed/);
		expect(controller.statusValue).toBe("errored");
	});
});

describe("IframeAppletController — outbound targetOrigin invariant (P0)", () => {
	it("ALWAYS posts with targetOrigin: '*' (regression: opaque iframe origin)", () => {
		const { controller, calls, fakeWindow } = createController();
		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		controller.applyTheme({ "--accent": "#fff" });
		controller.sendCallback("noop", { x: 1 });

		// At least three outbound posts: init (after ready), theme, callback.
		expect(calls.length).toBeGreaterThanOrEqual(3);
		for (const call of calls) {
			expect(call.targetOrigin).toBe("*");
		}
	});

	it("invariant constant exposes '*' for build-time assertions", () => {
		expect(IframeAppletController.__TARGET_ORIGIN_INVARIANT__).toBe("*");
	});
});

describe("IframeAppletController — inbound source-identity gate", () => {
	it("drops messages whose event.source is NOT the iframe's contentWindow", () => {
		const { controller, calls, fakeWindow } = createController();
		// Boot via correct source.
		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		const initCount = calls.filter(
			(c) => (c.envelope as { kind?: string }).kind === "init",
		).length;
		expect(initCount).toBe(1);

		// Hostile sibling source.
		const hostile = { postMessage: vi.fn() } as unknown as Window;
		const envelope = buildEnvelope("ready", { ready: true }, controller.channelId);
		window.dispatchEvent(
			new MessageEvent("message", { data: envelope, source: hostile }),
		);
		// init count should NOT have grown.
		const initCount2 = calls.filter(
			(c) => (c.envelope as { kind?: string }).kind === "init",
		).length;
		expect(initCount2).toBe(1);
	});

	it("drops messages with the wrong channelId nonce", () => {
		const { controller, calls, fakeWindow } = createController();
		// Correct channelId boots the handshake.
		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		const initCount = calls.filter(
			(c) => (c.envelope as { kind?: string }).kind === "init",
		).length;
		expect(initCount).toBe(1);

		// Confused-deputy iframe with a different channelId.
		const wrongEnvelope = buildEnvelope(
			"ready",
			{ ready: true },
			"wrong-channel-id",
		);
		window.dispatchEvent(
			new MessageEvent("message", { data: wrongEnvelope, source: fakeWindow }),
		);
		const initCount2 = calls.filter(
			(c) => (c.envelope as { kind?: string }).kind === "init",
		).length;
		expect(initCount2).toBe(1);
	});
});

describe("IframeAppletController — no-secrets-in-payload invariant (P0)", () => {
	it("applyTheme rejects an overrides map containing a credential field", () => {
		const { controller } = createController();
		expect(() =>
			controller.applyTheme({ apiKey: "leak" } as Record<string, string>),
		).toThrow(IframePayloadSecretLeakError);
	});

	it("sendCallback rejects a payload containing a credential field", () => {
		const { controller } = createController();
		expect(() =>
			controller.sendCallback("submit", { token: "leak" }),
		).toThrow(IframePayloadSecretLeakError);
	});

	it("getState rejects a payload key reference that smuggles a credential field", async () => {
		const { controller } = createController({
			getState: async () => null,
		});
		await expect(
			(controller as unknown as { requestReply: (k: string, p: unknown) => Promise<unknown> }).requestReply(
				"state-read",
				{ apiKey: "leak" },
			),
		).rejects.toThrow(IframePayloadSecretLeakError);
	});
});

describe("IframeAppletController — state proxy", () => {
	it("forwards state-read to the parent getState handler and replies", async () => {
		const getState = vi.fn(async () => "the-value");
		const { controller, fakeWindow } = createController({ getState });

		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		// Iframe asks for a key.
		const ackPromise = new Promise<unknown>((resolve) => {
			const listener = (event: MessageEvent) => {
				const env = event.data as { kind?: string; payload?: unknown };
				if (env?.kind === "state-read-ack") {
					window.removeEventListener("message", listener);
					resolve(env.payload);
				}
			};
			window.addEventListener("message", listener);
		});
		// Simulate a state-read request from inside the iframe.
		// The controller will reply via postMessage on fakeWindow — we
		// need to intercept that reply.
		const replyCalls: unknown[] = [];
		// Replace the fake postMessage to also re-dispatch into the
		// window so our ackPromise listener can hear it. Type the
		// reference to the string-targetOrigin overload of postMessage
		// — TS' DOM lib also exposes a (message, options) overload that
		// would mis-resolve our second arg as WindowPostMessageOptions.
		const origPostMessage = (
			fakeWindow as unknown as {
				postMessage: (message: unknown, targetOrigin: string) => void;
			}
		).postMessage;
		Object.defineProperty(fakeWindow, "postMessage", {
			value: (env: unknown, targetOrigin: string) => {
				origPostMessage.call(fakeWindow, env, targetOrigin);
				replyCalls.push(env);
				window.dispatchEvent(
					new MessageEvent("message", { data: env, source: fakeWindow }),
				);
			},
			configurable: true,
		});

		postFromIframe(controller, fakeWindow, "state-read", { key: "foo" });
		await ackPromise;

		expect(getState).toHaveBeenCalledWith("foo");
		expect(replyCalls.length).toBeGreaterThanOrEqual(1);
	});
});

describe("IframeAppletController — dispose", () => {
	it("removes the message listener and rejects pending replies", async () => {
		const { controller, fakeWindow } = createController({
			getState: async () => "x",
		});
		postFromIframe(controller, fakeWindow, "ready", { ready: true });

		const pending = controller.getState("never-acked");
		controller.dispose();
		await expect(pending).rejects.toThrow(/disposed/);
		expect(controller.statusValue).toBe("disposed");
	});

	it("dispose() is idempotent", () => {
		const { controller } = createController();
		controller.dispose();
		expect(() => controller.dispose()).not.toThrow();
	});
});

describe("IframeAppletController — resize protocol", () => {
	it("applies iframe.style.height on resize envelope", () => {
		const { controller, fakeWindow } = createController();
		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		postFromIframe(controller, fakeWindow, "resize", { height: 480 });
		expect(controller.element.style.height).toBe("480px");
	});

	it("ignores resize envelope with non-numeric height", () => {
		const { controller, fakeWindow } = createController();
		postFromIframe(controller, fakeWindow, "ready", { ready: true });
		postFromIframe(controller, fakeWindow, "resize", { height: "tall" });
		expect(controller.element.style.height).toBe("");
	});
});
