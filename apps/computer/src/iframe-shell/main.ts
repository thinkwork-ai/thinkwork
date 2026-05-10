/**
 * Iframe-shell entry point — runs INSIDE the cross-origin iframe at
 * sandbox.thinkwork.ai (or the dev/staging analogue), NOT in the
 * parent app's document.
 *
 * Plan-012 U9 shipped the inert scaffold. Plan-012 U10/U11 wire the
 * postMessage protocol and the TSX compile + mount pipeline. This
 * module is the iframe-side counterpart of
 * apps/computer/src/applets/iframe-controller.ts.
 *
 * Lifecycle:
 *   1. Boot — register the host registry inside the iframe scope and
 *      install the message listener.
 *   2. Send `kind: "ready"` envelope with a placeholder channelId so
 *      the parent's source-identity handshake can fire. (The parent's
 *      controller validates the channelId on every subsequent
 *      envelope; for the initial `ready` we mirror whatever channelId
 *      the parent attaches to its `init` envelope.)
 *   3. On `init` — verify origin against build-time
 *      __ALLOWED_PARENT_ORIGINS__, capture parent-origin + channelId,
 *      compile the TSX (TODO U11.5: full compile + mount pipeline
 *      lives in iframe-transform.ts; current path acknowledges the
 *      contract and posts ready-with-component so the parent's
 *      `controller.ready` promise resolves under the live protocol).
 *   4. Forward `securitypolicyviolation` events to the parent via
 *      `kind: "error"` envelopes so the layered Playwright CSP smoke
 *      can assert browser-level enforcement.
 *
 * What this file does NOT do (yet):
 *   - Compile TSX or render a real React component (U11.5 follow-up).
 *     The iframe-shell currently treats the init payload as
 *     authenticated handshake only; the rendered surface is the
 *     iframe-shell's own placeholder until the compile pipeline
 *     migrates.
 *   - Outbound network of any kind — iframe CSP `connect-src 'none'`
 *     blocks it, by design.
 */

import { registerAppletHost } from "../applets/host-registry";
import {
	ALLOWED_PARENT_ORIGINS,
	assertSafeAllowlist,
	buildEnvelope,
	type Envelope,
	type ErrorPayload,
	type InitPayload,
	type ReadyPayload,
	type ReadyWithComponentPayload,
	type ThemePayload,
} from "./iframe-protocol";

// Defense-in-depth — fail at boot if the build-time allowlist somehow
// contains "null" or "*".
assertSafeAllowlist(ALLOWED_PARENT_ORIGINS);

// Register the host registry inside the iframe's globalThis.
registerAppletHost();

interface IframeShellState {
	parentWindow: Window | null;
	channelId: string | null;
	mounted: boolean;
}

const state: IframeShellState = {
	parentWindow: null,
	channelId: null,
	mounted: false,
};

function postToParent<P>(
	kind: Envelope["kind"],
	payload: P,
	replyTo?: string,
): void {
	if (!state.parentWindow || !state.channelId) return;
	const envelope = buildEnvelope(kind, payload, state.channelId, replyTo);
	// Outbound to parent uses targetOrigin "*" because the iframe runs
	// at opaque origin; the parent's contentWindow + channelId checks
	// are the actual gate. The parent's iframe-controller mirrors the
	// same invariant on its outbound side.
	state.parentWindow.postMessage(envelope, "*");
}

function applyThemeOverrides(overrides: Record<string, string>): void {
	if (!overrides) return;
	for (const [key, value] of Object.entries(overrides)) {
		if (typeof key !== "string" || typeof value !== "string") continue;
		// Only allow CSS custom properties — values are inert strings,
		// keys must look like CSS variables (start with --).
		if (!key.startsWith("--")) continue;
		document.documentElement.style.setProperty(key, value);
	}
}

function handleInit(payload: InitPayload, msgId: string): void {
	if (state.mounted) {
		// Re-init for the same iframe is supported (theme refresh, source
		// regeneration). For now, just re-apply theme + acknowledge.
		applyThemeOverrides(payload.themeOverrides ?? {});
		const ack: ReadyWithComponentPayload = {
			rendered: true,
			renderedAt: new Date().toISOString(),
		};
		postToParent("ready-with-component", ack, msgId);
		return;
	}

	try {
		applyThemeOverrides(payload.themeOverrides ?? {});

		// TODO U11.5: drive the sucrase + import-shim transform pipeline
		// here against payload.tsx and mount the resulting component.
		// Until then, render a placeholder so the visible iframe content
		// reflects the handshake state and the parent's controller.ready
		// promise still resolves under the live protocol.
		const root = document.getElementById("thinkwork-iframe-shell-root");
		if (root) {
			const placeholder = document.createElement("div");
			placeholder.style.padding = "12px";
			placeholder.style.fontFamily = "system-ui, sans-serif";
			placeholder.style.fontSize = "13px";
			placeholder.style.color = "rgba(0,0,0,0.6)";
			placeholder.textContent = `iframe-shell ready (${payload.tsx.length} chars TSX, version ${payload.version})`;
			root.replaceChildren(placeholder);
		}

		state.mounted = true;

		const ack: ReadyWithComponentPayload = {
			rendered: true,
			renderedAt: new Date().toISOString(),
		};
		postToParent("ready-with-component", ack, msgId);
	} catch (err) {
		const error: ErrorPayload = {
			code: "RUNTIME_ERROR",
			message: err instanceof Error ? err.message : "iframe init failed",
			stack: err instanceof Error ? err.stack : undefined,
		};
		postToParent("error", error, msgId);
	}
}

function handleTheme(payload: ThemePayload): void {
	applyThemeOverrides(payload.overrides ?? {});
}

function isAllowedParentOrigin(origin: string): boolean {
	if (!origin || origin === "null" || origin === "*") return false;
	return ALLOWED_PARENT_ORIGINS.includes(origin);
}

if (typeof window !== "undefined") {
	// Forward securitypolicyviolation events to the parent (via the
	// established channel) so the Playwright smoke at deploy time can
	// assert browser-level CSP enforcement is firing for known-bad
	// fragments. Until the parent has captured channelId via init, we
	// only log to console — the smoke runs after init handshake.
	window.addEventListener("securitypolicyviolation", (event) => {
		const cspEvent = event as SecurityPolicyViolationEvent;
		const error: ErrorPayload = {
			code: "CSP_VIOLATION",
			message: `CSP violation: ${cspEvent.violatedDirective}`,
			detail: `blocked: ${cspEvent.blockedURI}; document: ${cspEvent.documentURI}`,
		};
		if (state.parentWindow && state.channelId) {
			postToParent("error", error);
		} else {
			// eslint-disable-next-line no-console
			console.warn("[iframe-shell] CSP violation pre-handshake", error);
		}
	});

	window.addEventListener("message", (event: MessageEvent) => {
		// Origin allowlist gate — drop silently if the parent isn't on
		// the build-time-injected list. "null" and "*" are also rejected
		// by isAllowedParentOrigin defensively.
		if (!isAllowedParentOrigin(event.origin)) return;

		const data = event.data;
		if (!data || typeof data !== "object") return;
		const candidate = data as Partial<Envelope>;
		if (candidate.v !== 1) return;
		if (typeof candidate.kind !== "string") return;
		if (typeof candidate.channelId !== "string") return;
		if (typeof candidate.msgId !== "string") return;

		// Capture parent identity + channelId on the first init envelope
		// that comes in. Subsequent envelopes must match.
		if (state.parentWindow === null) {
			state.parentWindow = event.source as Window;
			state.channelId = candidate.channelId;
		} else {
			if (state.parentWindow !== event.source) return;
			if (state.channelId !== candidate.channelId) return;
		}

		switch (candidate.kind) {
			case "init":
				handleInit(candidate.payload as InitPayload, candidate.msgId);
				return;
			case "theme":
				handleTheme(candidate.payload as ThemePayload);
				return;
			case "callback":
				// TODO U11.5: route declared callbacks into the mounted
				// component. Acknowledge silently for now.
				return;
			case "state-read-ack":
			case "state-write-ack":
				// Parent acks for state proxy requests the iframe issued.
				// No-op here — the iframe-side useAppletAPI stub (added in
				// U11.5) will keep a pendingReplies map.
				return;
			default:
				return;
		}
	});

	// Send the initial `ready` envelope. The parent doesn't know the
	// channelId yet — it ignores the channelId on this very first
	// envelope and waits for our second `ready` (which mirrors the
	// channelId from the parent's init). To keep the protocol simple
	// and deterministic, we DON'T post anything proactively here:
	// instead, we wait for the parent's init envelope (which carries
	// the parent's channelId) and reply with ready-with-component.
	//
	// The parent's IframeAppletController posts init only after seeing
	// our `ready` though — so to break the chicken-and-egg, we send a
	// `ready` envelope with the placeholder channelId "_pending" that
	// the parent's validateInboundEnvelope will reject. This is
	// deliberate: the parent treats the iframe `load` event as the
	// secondary trigger for posting init. See iframe-controller's
	// installLoadHandshake comment.
	//
	// In practice the working sequence is:
	//   1. parent creates iframe with src = sandbox URL
	//   2. iframe loads, our message listener registers
	//   3. parent receives 'load' DOM event, posts init unconditionally
	//      with the parent's channelId
	//   4. our message listener captures parent identity + channelId on
	//      that init, replies with ready-with-component
	// To enable this, the parent needs to post init on `load` — see
	// the U11 controller update.
}

// Export for tests — confirms the module's wiring without doing anything
// observable to the iframe runtime.
export const __IFRAME_SHELL_LIVE__ = "U11_IFRAME_SHELL_LIVE" as const;
