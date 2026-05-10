/**
 * Iframe-shell entry point — runs INSIDE the cross-origin iframe at
 * sandbox.thinkwork.ai (or the dev/staging analogue).
 *
 * Plan-012 U11.5 — full TSX compile + mount pipeline:
 *   1. Boot — register the host registry inside the iframe scope and
 *      install the message listener. Validate origin allowlist.
 *   2. On `init` — sucrase-transform the payload TSX, run the
 *      acorn-based import-shim allowlist, instantiate via dynamic
 *      import() of a blob URL, mount the default export via
 *      React.createRoot.
 *   3. Forward `securitypolicyviolation` events to the parent via
 *      `kind: "error"` envelopes.
 *   4. State proxy — useAppletAPI inside the iframe routes through
 *      the parent via state-read / state-write envelopes; pendingReplies
 *      keyed by msgId.
 */

import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { transform as sucraseTransform } from "sucrase";
import {
	registerAppletHost,
	loadAppletHostExternals,
} from "../applets/host-registry";
import { rewriteAppletImports } from "../applets/transform/import-shim";
import {
	ALLOWED_PARENT_ORIGINS,
	assertSafeAllowlist,
	buildEnvelope,
	type Envelope,
	type ErrorPayload,
	type InitPayload,
	type ReadyWithComponentPayload,
	type ThemePayload,
} from "./iframe-protocol";

assertSafeAllowlist(ALLOWED_PARENT_ORIGINS);

// Register the host registry inside the iframe's globalThis. Then load
// React, ReactDOM, jsx-runtime, @thinkwork/ui, @thinkwork/computer-stdlib,
// recharts, lucide-react, leaflet, react-leaflet into it so compiled
// fragments can resolve their imports against the registry. We start
// the load proactively at boot so the first init handshake doesn't pay
// the dynamic-import latency.
registerAppletHost();
const registryReady = loadAppletHostExternals().catch((err) => {
	// eslint-disable-next-line no-console
	console.warn("[iframe-shell] host externals load failed", err);
});

interface IframeShellState {
	parentWindow: Window | null;
	channelId: string | null;
	mounted: boolean;
	root: Root | null;
	rootContainer: HTMLDivElement | null;
	pendingStateReplies: Map<
		string,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void }
	>;
}

const state: IframeShellState = {
	parentWindow: null,
	channelId: null,
	mounted: false,
	root: null,
	rootContainer: null,
	pendingStateReplies: new Map(),
};

function postToParent<P>(
	kind: Envelope["kind"],
	payload: P,
	replyTo?: string,
): void {
	if (!state.parentWindow || !state.channelId) return;
	const envelope = buildEnvelope(kind, payload, state.channelId, replyTo);
	state.parentWindow.postMessage(envelope, "*");
}

function applyThemeOverrides(overrides: Record<string, string>): void {
	if (!overrides) return;
	for (const [key, value] of Object.entries(overrides)) {
		if (typeof key !== "string" || typeof value !== "string") continue;
		if (!key.startsWith("--")) continue;
		document.documentElement.style.setProperty(key, value);
	}
}

function isAllowedParentOrigin(origin: string): boolean {
	if (!origin || origin === "null" || origin === "*") return false;
	return ALLOWED_PARENT_ORIGINS.includes(origin);
}

function createCompiledModuleUrl(code: string): string {
	if (typeof URL.createObjectURL === "function") {
		return URL.createObjectURL(
			new Blob([code], { type: "application/javascript" }),
		);
	}
	return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
}

async function compileAndMount(
	payload: InitPayload,
	msgId: string,
): Promise<void> {
	try {
		// Wait for host externals (react / @thinkwork/ui / etc.) to load.
		await registryReady;

		// Sucrase-transform the TSX.
		let compiledCode: string;
		try {
			const sucraseResult = sucraseTransform(payload.tsx, {
				transforms: ["typescript", "jsx"],
				keepUnusedImports: true,
				preserveDynamicImport: true,
				production: true,
				jsxRuntime: "automatic",
			});
			// Acorn import-shim — rejects forbidden imports, rewrites
			// allowed ones to globalThis.__THINKWORK_APPLET_HOST__ lookups.
			compiledCode = rewriteAppletImports(sucraseResult.code);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "compile failed";
			postToParent<ErrorPayload>(
				"error",
				{
					code: err && typeof err === "object" && "failure" in err
						? "IMPORT_REJECTED"
						: "COMPILE_FAILED",
					message,
				},
				msgId,
			);
			return;
		}

		// Dynamic-import the compiled module via a blob URL. This runs
		// inside the iframe's own scope; the iframe's CSP `script-src
		// 'self' blob:` permits it. Same sandbox attribute on the parent
		// iframe (allow-scripts only) keeps the module isolated.
		const moduleUrl = createCompiledModuleUrl(compiledCode);
		const module = (await import(/* @vite-ignore */ moduleUrl)) as {
			default?: unknown;
		};

		const Component = module.default;
		if (typeof Component !== "function") {
			postToParent<ErrorPayload>(
				"error",
				{
					code: "RUNTIME_ERROR",
					message:
						"Applet module must export a default React component.",
				},
				msgId,
			);
			URL.revokeObjectURL(moduleUrl);
			return;
		}

		// Apply theme overrides before mount so the first paint matches.
		applyThemeOverrides(payload.themeOverrides ?? {});

		// Mount or re-mount.
		const rootEl = document.getElementById("thinkwork-iframe-shell-root");
		if (!rootEl) {
			postToParent<ErrorPayload>(
				"error",
				{
					code: "RUNTIME_ERROR",
					message: "iframe-shell root element missing",
				},
				msgId,
			);
			URL.revokeObjectURL(moduleUrl);
			return;
		}

		// Reuse the existing root if possible; createRoot on the same
		// container twice produces a console warning.
		if (state.root && state.rootContainer === rootEl) {
			state.root.render(
				createElement(Component as React.ComponentType, {}),
			);
		} else {
			if (state.root) state.root.unmount();
			state.root = createRoot(rootEl);
			state.rootContainer = rootEl as HTMLDivElement;
			state.root.render(
				createElement(Component as React.ComponentType, {}),
			);
		}
		state.mounted = true;

		// Notify the parent the component rendered.
		const ack: ReadyWithComponentPayload = {
			rendered: true,
			renderedAt: new Date().toISOString(),
		};
		postToParent("ready-with-component", ack, msgId);

		// Clean up the blob URL — the import has cached the module
		// reference, so revoking the URL doesn't unload it.
		URL.revokeObjectURL(moduleUrl);
	} catch (err) {
		postToParent<ErrorPayload>(
			"error",
			{
				code: "RUNTIME_ERROR",
				message: err instanceof Error ? err.message : "mount failed",
				stack: err instanceof Error ? err.stack : undefined,
			},
			msgId,
		);
	}
}

function handleInit(payload: InitPayload, msgId: string): void {
	void compileAndMount(payload, msgId);
}

function handleTheme(payload: ThemePayload): void {
	applyThemeOverrides(payload.overrides ?? {});
}

if (typeof window !== "undefined") {
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
		// Origin allowlist gate.
		if (!isAllowedParentOrigin(event.origin)) return;

		const data = event.data;
		if (!data || typeof data !== "object") return;
		const candidate = data as Partial<Envelope>;
		if (candidate.v !== 1) return;
		if (typeof candidate.kind !== "string") return;
		if (typeof candidate.channelId !== "string") return;
		if (typeof candidate.msgId !== "string") return;

		// Capture parent identity + channelId on the first init envelope.
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
				// TODO: route into mounted component when the component
				// surface declares a callback registry. Acknowledge silently.
				return;
			case "state-read-ack":
			case "state-write-ack": {
				const replyTo = candidate.replyTo;
				if (!replyTo) return;
				const pending = state.pendingStateReplies.get(replyTo);
				if (!pending) return;
				state.pendingStateReplies.delete(replyTo);
				const payload = candidate.payload as
					| { value?: unknown; ok?: boolean }
					| undefined;
				pending.resolve(
					candidate.kind === "state-read-ack"
						? payload?.value
						: (payload?.ok ?? false),
				);
				return;
			}
			default:
				return;
		}
	});
}

/**
 * Iframe-side state-proxy helpers. The iframe-shell exposes these on
 * `globalThis` so the iframe-side `useAppletAPI` (re-exposed from
 * @thinkwork/computer-stdlib) can call through to the parent.
 */
declare global {
	interface Window {
		__THINKWORK_IFRAME_STATE_PROXY__?: {
			read: (key: string) => Promise<unknown>;
			write: (key: string, value: unknown) => Promise<void>;
		};
	}
}

if (typeof window !== "undefined") {
	window.__THINKWORK_IFRAME_STATE_PROXY__ = {
		async read(key: string): Promise<unknown> {
			return new Promise((resolve, reject) => {
				if (!state.parentWindow || !state.channelId) {
					reject(
						new Error(
							"iframe-shell state proxy: parent handshake not yet complete",
						),
					);
					return;
				}
				const envelope = buildEnvelope(
					"state-read",
					{ key },
					state.channelId,
				);
				state.pendingStateReplies.set(envelope.msgId, {
					resolve,
					reject,
				});
				state.parentWindow.postMessage(envelope, "*");
			});
		},
		async write(key: string, value: unknown): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				if (!state.parentWindow || !state.channelId) {
					reject(
						new Error(
							"iframe-shell state proxy: parent handshake not yet complete",
						),
					);
					return;
				}
				const envelope = buildEnvelope(
					"state-write",
					{ key, value },
					state.channelId,
				);
				state.pendingStateReplies.set(envelope.msgId, {
					resolve: () => resolve(),
					reject,
				});
				state.parentWindow.postMessage(envelope, "*");
			});
		},
	};
}

export const __IFRAME_SHELL_LIVE__ = "U11_IFRAME_SHELL_LIVE" as const;
