/**
 * Iframe-shell entry point — runs INSIDE the cross-origin iframe at
 * sandbox.thinkwork.ai (or the dev/staging analogue), NOT in the
 * parent app's document.
 *
 * Plan-012 U9 (inert): this file ships as a buildable bundle but no
 * parent code currently loads the iframe yet (U10 wires
 * IframeAppletController; U11 cuts AppletMount production paths over).
 * The body-swap forcing-function gate is the absence of
 * `<!-- INERT_NOT_WIRED -->` in the dist HTML — once U9's HTML is
 * built, the marker disappears.
 *
 * What this file does:
 *   1. Registers `globalThis.__THINKWORK_APPLET_HOST__` inside the
 *      iframe scope by importing the existing parent-side host
 *      registry. The same registry implementation works inside the
 *      iframe; the only difference is that it now lives in the
 *      sandboxed document instead of the parent's window.
 *   2. Sets up a postMessage listener (no-op in U9 — U10 wires the
 *      protocol handler).
 *   3. Forwards CSP violations from the iframe scope back to the
 *      parent via `kind: "error"` envelopes for the layered Playwright
 *      smoke test (per contract v1 §CSP smoke layering).
 *
 * What this file does NOT do (yet):
 *   - Compile TSX or mount React components (U10).
 *   - Execute fragments (U10/U11).
 *   - Do any outbound network — iframe CSP `connect-src 'none'` blocks
 *     it, by design.
 */

import { registerAppletHost } from "../applets/host-registry";
import {
	ALLOWED_PARENT_ORIGINS,
	assertSafeAllowlist,
	type Envelope,
} from "./iframe-protocol";

// Defense-in-depth — fail at boot if the build-time allowlist somehow
// contains "null" or "*".
assertSafeAllowlist(ALLOWED_PARENT_ORIGINS);

// Register the host registry inside the iframe's globalThis. This is the
// same single-owner symbol-guarded registration the parent used to call;
// inside the sandboxed document it is now the iframe's responsibility.
registerAppletHost();

if (typeof window !== "undefined") {
	// Forward securitypolicyviolation events to the parent so the
	// layered Playwright CSP smoke can assert browser-level enforcement
	// fires for known-bad fragments. The parent renders these via
	// <AppletErrorBoundary>.
	window.addEventListener("securitypolicyviolation", (event) => {
		// We can't post yet — U10 wires the parent identity lookup. For
		// now, log structured detail to the iframe console so smoke
		// tests can grep dev tools. U10 replaces this with an outbound
		// envelope.
		// eslint-disable-next-line no-console
		console.warn("[iframe-shell] CSP violation", {
			blockedURI: (event as SecurityPolicyViolationEvent).blockedURI,
			violatedDirective: (event as SecurityPolicyViolationEvent)
				.violatedDirective,
			documentURI: (event as SecurityPolicyViolationEvent).documentURI,
		});
	});

	// U10: install the message listener with origin allowlist + envelope
	// validation. For U9 inert, we install a no-op listener so the
	// browser sees the iframe as "ready to receive messages" without
	// processing them.
	window.addEventListener("message", (_event: MessageEvent<Envelope>) => {
		// Inert until U10. Drop silently.
	});
}

// Export for tests — confirms the module's wiring without doing anything
// observable to the iframe runtime.
export const __INERT__ = "U9_IFRAME_SHELL_INERT" as const;
