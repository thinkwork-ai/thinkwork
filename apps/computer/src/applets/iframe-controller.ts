/**
 * Parent-side iframe applet controller (plan-012 U10).
 *
 * The controller creates an `<iframe sandbox="allow-scripts">` element
 * pointing at `__SANDBOX_IFRAME_SRC__`, mints a fresh per-iframe
 * channelId nonce, and drives the postMessage protocol defined in
 * `apps/computer/src/iframe-shell/iframe-protocol.ts`.
 *
 * Trust mechanism (load-bearing — see contract v1 §Parent <-> iframe
 * postMessage protocol):
 *   - Outbound: `iframe.contentWindow.postMessage(envelope, "*")`.
 *     `targetOrigin: "*"` is REQUIRED — the iframe document under
 *     `sandbox="allow-scripts"` (no `allow-same-origin`) has an opaque
 *     origin; a concrete origin string would silently fail delivery.
 *     A regression test fails the build if any code path passes a
 *     concrete origin.
 *   - Inbound: `event.source === iframeWindow` AND
 *     `envelope.channelId === channelId`. Origin equality is NOT used
 *     because iframe `event.origin` is `"null"` under the sandbox.
 *   - No secrets in payload: `assertNoSecretsInPayload` runs over every
 *     outbound envelope payload and throws if any known credential
 *     field name appears. State proxy operations round-trip through
 *     the parent — the iframe never sees raw credentials.
 *
 * Public surface (consumed by `AppletMount`, `InlineAppletEmbed`,
 * `AppArtifactSplitShell`):
 *
 *   const controller = new IframeAppletController({ tsx, version, themeOverrides });
 *   parent.appendChild(controller.element);
 *   await controller.ready;
 *   controller.applyTheme({ "--color-primary": "#fff" });
 *   const value = await controller.getState("foo");
 *   await controller.setState("foo", "bar");
 *   controller.dispose();
 *
 * There is no same-origin generated-code fallback. If the sandbox
 * iframe shell is unavailable, generated app rendering fails closed
 * instead of executing LLM-authored code in the parent origin.
 */

import {
	ALLOWED_PARENT_ORIGINS,
	SANDBOX_IFRAME_SRC,
	assertNoSecretsInPayload,
	buildEnvelope,
	newChannelId,
	validateInboundEnvelope,
	type Envelope,
	type ErrorPayload,
	type InitPayload,
	type ReadyWithComponentPayload,
	type ResizePayload,
	type StateReadAckPayload,
	type StateReadPayload,
	type StateWriteAckPayload,
	type StateWritePayload,
	type WheelPayload,
} from "@/iframe-shell/iframe-protocol";

export interface IframeControllerOptions {
	/** TSX source from the agent. Sent in the `init` envelope payload. */
	tsx: string;
	/** Source version for the iframe-shell's transform cache. */
	version: string;
	/** Initial theme overrides (CSS variables). Static theme tokens ship
	 * with the iframe-shell bundle so this map carries only dynamic
	 * overrides (e.g., dark/light mode). */
	themeOverrides?: Record<string, string>;
	/** Host color scheme. The iframe owns a separate document, so the
	 * host's `.dark` class does not cascade across the boundary. */
	theme?: "light" | "dark";
	/**
	 * State proxy. The parent runs the actual GraphQL operation against
	 * `appletState` resolvers — the iframe sees only the result.
	 */
	getState?: (key: string) => Promise<unknown>;
	setState?: (key: string, value: unknown) => Promise<void>;
	/** Declared callbacks the iframe may invoke. */
	onCallback?: (name: string, payload: unknown) => void;
	/** Surfaced errors (from import-shim rejection, runtime errors, or
	 * CSP violations). */
	onError?: (error: ErrorPayload) => void;
	/** Override the iframe src for tests. Production code never sets this. */
	srcOverride?: string;
	/** Override the inbound source-identity check for tests. Production
	 * code uses the iframe's contentWindow. */
	sourceWindowOverride?: Window | null;
	/** Inline thread embeds should grow to the rendered app height instead
	 * of creating a nested iframe scrollbar. Full artifact pages leave this
	 * false so the iframe fills the viewport canvas. */
	fitContentHeight?: boolean;
}

export type IframeControllerStatus =
	| "pending"
	| "ready"
	| "errored"
	| "disposed";

function iframeSrcForInitialTheme(
	src: string,
	theme: "light" | "dark" | undefined,
): string {
	if (theme !== "dark") return src;

	try {
		const url = new URL(src, window.location.href);
		if (url.pathname.endsWith("/iframe-shell.html")) {
			url.pathname = url.pathname.replace(
				/iframe-shell\.html$/,
				"iframe-shell-dark.html",
			);
		}
		url.searchParams.set("tw-theme", theme);
		return url.toString();
	} catch {
		return src;
	}
}

function wheelDeltaToPixels(
	delta: number,
	deltaMode: number,
	viewportSize: number,
): number {
	if (deltaMode === 1) return delta * 16;
	if (deltaMode === 2) return delta * viewportSize;
	return delta;
}

function scrollElementBy(
	element: Element | Window,
	left: number,
	top: number,
): void {
	if ("scrollBy" in element && typeof element.scrollBy === "function") {
		element.scrollBy({ left, top, behavior: "auto" });
		return;
	}
	if (element instanceof Window) {
		element.scrollTo(element.scrollX + left, element.scrollY + top);
		return;
	}
	const htmlElement = element as HTMLElement;
	htmlElement.scrollLeft += left;
	htmlElement.scrollTop += top;
}

function scrollNearestScrollableAncestor(
	iframe: HTMLIFrameElement,
	payload: WheelPayload,
): void {
	const ownerWindow = iframe.ownerDocument.defaultView ?? window;
	const deltaX = wheelDeltaToPixels(
		payload.deltaX,
		payload.deltaMode,
		ownerWindow.innerWidth || iframe.clientWidth || 1,
	);
	const deltaY = wheelDeltaToPixels(
		payload.deltaY,
		payload.deltaMode,
		ownerWindow.innerHeight || iframe.clientHeight || 1,
	);

	for (let node = iframe.parentElement; node; node = node.parentElement) {
		const style = ownerWindow.getComputedStyle(node);
		const canScrollY =
			/(auto|scroll|overlay)/.test(style.overflowY) &&
			node.scrollHeight > node.clientHeight;
		const canScrollX =
			/(auto|scroll|overlay)/.test(style.overflowX) &&
			node.scrollWidth > node.clientWidth;

		if (canScrollY || canScrollX) {
			scrollElementBy(node, canScrollX ? deltaX : 0, canScrollY ? deltaY : 0);
			return;
		}
	}

	scrollElementBy(ownerWindow, deltaX, deltaY);
}

export class IframeAppletController {
	readonly element: HTMLIFrameElement;
	readonly channelId: string;
	readonly ready: Promise<void>;

	private status: IframeControllerStatus = "pending";
	private readyResolve?: () => void;
	private readyReject?: (err: Error) => void;
	private pendingReplies = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (err: Error) => void;
		}
	>();
	private opts: IframeControllerOptions;
	private messageListener: ((event: MessageEvent) => void) | null = null;
	private themeOverrides: Record<string, string>;
	private theme: "light" | "dark" | undefined;
	private lastReportedContentHeight = 0;
	private fitContentHeight: boolean;

	constructor(opts: IframeControllerOptions) {
		this.opts = opts;
		this.themeOverrides = { ...(opts.themeOverrides ?? {}) };
		this.theme = opts.theme;
		this.fitContentHeight = Boolean(opts.fitContentHeight);
		this.channelId = newChannelId();

		this.element = document.createElement("iframe");
		// IMPORTANT: no `allow-same-origin`. The opaque-origin sandbox is
		// the load-bearing security boundary. Adding it would re-open
		// parent-DOM access and break the iframe-isolation contract.
		// Use setAttribute (vs. iframe.sandbox.add) for portability —
		// jsdom doesn't expose .sandbox as a DOMTokenList.
		this.element.setAttribute("sandbox", "allow-scripts");
		this.element.src = iframeSrcForInitialTheme(
			opts.srcOverride ?? SANDBOX_IFRAME_SRC,
			this.theme,
		);
		this.element.style.border = "0";
		this.element.style.borderRadius = "0";
		this.element.style.width = "100%";
		this.element.style.height = "100%";
		this.element.style.minHeight = "480px";
		this.element.style.display = "block";
		this.element.style.backgroundColor =
			this.theme === "dark" ? "#09090b" : "transparent";
		this.element.style.colorScheme = this.theme ?? "normal";
		this.element.setAttribute("data-channel-id", this.channelId);
		this.element.setAttribute("data-applet-iframe", "true");
		// Smoke pin: `data-ready` is set to "true" once the iframe sends
		// `ready-with-component` matching channelId.
		this.element.setAttribute("data-ready", "false");

		this.ready = new Promise<void>((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
		});

		this.installMessageListener();
		this.installLoadHandshake();
	}

	get statusValue(): IframeControllerStatus {
		return this.status;
	}

	private installMessageListener(): void {
		const expectedSource =
			this.opts.sourceWindowOverride !== undefined
				? this.opts.sourceWindowOverride
				: this.element.contentWindow;

		this.messageListener = (event: MessageEvent) => {
			// Source-identity gate. The iframe's event.origin is "null"
			// under the opaque-origin sandbox, so we do NOT validate
			// origin here — the trust is the contentWindow identity.
			const source =
				this.opts.sourceWindowOverride !== undefined
					? this.opts.sourceWindowOverride
					: this.element.contentWindow;
			if (event.source !== source) return;

			const envelope = validateInboundEnvelope(event.data, this.channelId);
			if (!envelope) return;

			this.handleInbound(envelope);
		};
		window.addEventListener("message", this.messageListener);
	}

	private installLoadHandshake(): void {
		this.element.addEventListener("load", () => {
			// The iframe-shell can't post a `ready` envelope first because
			// it doesn't know our channelId yet (the parent mints the
			// nonce). We resolve the chicken-and-egg by posting `init`
			// unconditionally on the iframe's `load` DOM event — by then
			// the iframe's main.ts has booted and registered its message
			// listener. The iframe captures our channelId from this init
			// and replies with `ready-with-component`.
			this.postInit();
		});
	}

	private handleInbound(envelope: Envelope): void {
		switch (envelope.kind) {
			case "ready": {
				// Iframe-shell is up. Send init.
				this.postInit();
				return;
			}
			case "ready-with-component": {
				const payload = envelope.payload as ReadyWithComponentPayload;
				if (payload?.rendered === true) {
					this.element.setAttribute("data-ready", "true");
					this.status = "ready";
					this.readyResolve?.();
				}
				return;
			}
			case "resize": {
				const payload = envelope.payload as ResizePayload;
				if (typeof payload?.height === "number") {
					this.applyReportedSize(payload.height);
				}
				return;
			}
			case "wheel": {
				if (!this.fitContentHeight) return;
				const payload = envelope.payload as WheelPayload;
				if (
					typeof payload?.deltaX === "number" &&
					typeof payload.deltaY === "number" &&
					typeof payload.deltaMode === "number"
				) {
					scrollNearestScrollableAncestor(this.element, payload);
				}
				return;
			}
			case "callback": {
				const payload = envelope.payload as {
					name: string;
					payload: unknown;
				};
				this.opts.onCallback?.(payload.name, payload.payload);
				return;
			}
			case "state-read": {
				const payload = envelope.payload as StateReadPayload;
				const getter = this.opts.getState;
				if (!getter) {
					this.postError(envelope.msgId, {
						code: "RUNTIME_ERROR",
						message: "state-read requested but no getState handler is registered",
					});
					return;
				}
				getter(payload.key)
					.then((value) =>
						this.postReply<StateReadAckPayload>(
							"state-read-ack",
							{ value },
							envelope.msgId,
						),
					)
					.catch((err: unknown) => {
						this.postError(envelope.msgId, {
							code: "RUNTIME_ERROR",
							message:
								err instanceof Error ? err.message : "state-read failed",
						});
					});
				return;
			}
			case "state-write": {
				const payload = envelope.payload as StateWritePayload;
				const setter = this.opts.setState;
				if (!setter) {
					this.postError(envelope.msgId, {
						code: "RUNTIME_ERROR",
						message: "state-write requested but no setState handler is registered",
					});
					return;
				}
				setter(payload.key, payload.value)
					.then(() =>
						this.postReply<StateWriteAckPayload>(
							"state-write-ack",
							{ ok: true },
							envelope.msgId,
						),
					)
					.catch((err: unknown) => {
						this.postError(envelope.msgId, {
							code: "RUNTIME_ERROR",
							message:
								err instanceof Error ? err.message : "state-write failed",
						});
					});
				return;
			}
			case "state-read-ack":
			case "state-write-ack": {
				const replyTo = envelope.replyTo;
				if (!replyTo) return;
				const pending = this.pendingReplies.get(replyTo);
				if (!pending) return;
				this.pendingReplies.delete(replyTo);
				if (envelope.kind === "state-read-ack") {
					pending.resolve(
						(envelope.payload as StateReadAckPayload)?.value,
					);
				} else {
					pending.resolve(
						(envelope.payload as StateWriteAckPayload)?.ok ?? false,
					);
				}
				return;
			}
			case "error": {
				const payload = envelope.payload as ErrorPayload;
				this.opts.onError?.(payload);
				if (this.status === "pending") {
					this.status = "errored";
					this.readyReject?.(
						new Error(`iframe init failed: ${payload?.message ?? "unknown"}`),
					);
				}
				return;
			}
		}
		// Reply envelopes that don't match a pending request are dropped.
	}

	private postInit(): void {
		const payload: InitPayload = {
			tsx: this.opts.tsx,
			version: this.opts.version,
			theme: this.theme,
			themeOverrides: this.themeOverrides,
			fitContentHeight: this.fitContentHeight,
		};
		this.postOutbound("init", payload);
	}

	private postOutbound<P>(
		kind: Envelope["kind"],
		payload: P,
		replyTo?: string,
	): void {
		// No-secrets invariant. This is the load-bearing check that
		// makes targetOrigin: "*" safe by construction.
		assertNoSecretsInPayload(payload);
		const envelope = buildEnvelope(kind, payload, this.channelId, replyTo);
		const target = this.element.contentWindow;
		if (!target) return;
		// targetOrigin MUST be "*" — see contract v1 §Anti-pattern: tightening targetOrigin.
		// Concrete origin strings silently fail delivery against the
		// opaque iframe document. The U10 regression test below this
		// file's path asserts this with a spy.
		target.postMessage(envelope, "*");
	}

	private postReply<P>(
		kind: Envelope["kind"],
		payload: P,
		replyTo: string,
	): void {
		this.postOutbound(kind, payload, replyTo);
	}

	private postError(
		replyTo: string | undefined,
		payload: ErrorPayload,
	): void {
		const envelope = buildEnvelope(
			"error",
			payload,
			this.channelId,
			replyTo,
		);
		const target = this.element.contentWindow;
		if (!target) return;
		target.postMessage(envelope, "*");
	}

	private applyReportedSize(contentHeight: number): void {
		this.lastReportedContentHeight = Math.max(0, contentHeight);
		if (this.fitContentHeight) {
			this.element.style.height = `${Math.max(
				this.lastReportedContentHeight,
				480,
			)}px`;
			this.element.style.minHeight = "480px";
			return;
		}

		const parentHeight = this.element.parentElement?.clientHeight ?? 0;

		if (parentHeight > 0) {
			this.element.style.height = "100%";
			this.element.style.minHeight = "0";
			return;
		}

		this.element.style.height = `${Math.max(
			this.lastReportedContentHeight,
			480,
		)}px`;
		this.element.style.minHeight = "480px";
	}

	/**
	 * Push a fresh theme-override map into the iframe scope. Static
	 * base theme tokens ship with the iframe-shell bundle; this only
	 * carries dynamic overrides (dark/light mode toggle, accent color).
	 */
	applyTheme(
		overrides: Record<string, string>,
		theme?: "light" | "dark",
	): void {
		this.themeOverrides = { ...overrides };
		this.theme = theme ?? this.theme;
		this.postOutbound("theme", { theme: this.theme, overrides });
	}

	/** Invoke a declared callback on the iframe-rendered component. */
	sendCallback(name: string, payload: unknown): void {
		this.postOutbound("callback", { name, payload });
	}

	/** Read state through the parent's GraphQL proxy. */
	getState(key: string): Promise<unknown> {
		return this.requestReply<unknown>("state-read", { key });
	}

	/** Write state through the parent's GraphQL proxy. */
	setState(key: string, value: unknown): Promise<void> {
		return this.requestReply<void>("state-write", { key, value });
	}

	private requestReply<R>(
		kind: Envelope["kind"],
		payload: unknown,
	): Promise<R> {
		return new Promise<R>((resolve, reject) => {
			assertNoSecretsInPayload(payload);
			const envelope = buildEnvelope(kind, payload, this.channelId);
			this.pendingReplies.set(envelope.msgId, {
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			const target = this.element.contentWindow;
			if (!target) {
				reject(new Error("iframe contentWindow is not available"));
				return;
			}
			target.postMessage(envelope, "*");
		});
	}

	dispose(): void {
		if (this.status === "disposed") return;
		if (this.messageListener) {
			window.removeEventListener("message", this.messageListener);
			this.messageListener = null;
		}
		for (const pending of this.pendingReplies.values()) {
			pending.reject(new Error("iframe controller disposed"));
		}
		this.pendingReplies.clear();
		// Element removal is the caller's responsibility (it's part of
		// their React tree). We just neutralize the controller.
		this.status = "disposed";
	}

	/** Defensive helper for tests asserting we never use a non-"*"
	 * targetOrigin against the opaque iframe. */
	static get __TARGET_ORIGIN_INVARIANT__(): "*" {
		return "*";
	}
}

/**
 * The `__ALLOWED_PARENT_ORIGINS__` import is kept here as a documentation
 * anchor — the parent does not validate origins on inbound (the source
 * identity + channelId nonce are the gate). The iframe-shell's
 * `event.origin` check uses the same constant. Re-exporting from the
 * controller keeps the module the obvious place for parent-side
 * security review.
 */
export { ALLOWED_PARENT_ORIGINS };
