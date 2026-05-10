/**
 * Parent <-> iframe-shell postMessage protocol envelope types and helpers.
 *
 * Plan-012 U9 (inert; U10 wires the live postMessage handler in
 * iframe-controller.ts and main.ts).
 *
 * Contract: docs/specs/computer-ai-elements-contract-v1.md
 *   §Parent <-> iframe `postMessage` protocol
 *
 * Trust mechanism (load-bearing — DO NOT regress):
 *   - Iframe runs at opaque origin (sandbox="allow-scripts" without
 *     allow-same-origin), so `event.origin` from iframe inbound is "null".
 *   - Parent inbound trust: event.source === iframeWindow AND
 *     envelope.channelId === expectedChannelId. NOT origin equality.
 *   - Parent outbound: targetOrigin: "*" (REQUIRED — concrete origin
 *     fails delivery against opaque iframe). Trust comes from pinned
 *     iframe.src + iframe-side build-time __ALLOWED_PARENT_ORIGINS__
 *     allowlist + per-envelope channelId nonce + no-secrets-in-payload
 *     invariant.
 *   - Iframe inbound: event.origin in __ALLOWED_PARENT_ORIGINS__ (Vite
 *     `define`-injected at build time). null and "*" MUST NEVER be in
 *     the allowlist.
 */

export type EnvelopeKind =
	| "init"
	| "ready"
	| "ready-with-component"
	| "theme"
	| "resize"
	| "callback"
	| "state-read"
	| "state-read-ack"
	| "state-write"
	| "state-write-ack"
	| "error";

export interface Envelope<P = unknown> {
	v: 1;
	kind: EnvelopeKind;
	payload: P;
	msgId: string;
	replyTo?: string;
	channelId: string;
}

// --- payload shapes per envelope kind --------------------------------------

export interface InitPayload {
	tsx: string;
	version: string;
	theme?: "light" | "dark";
	themeOverrides?: Record<string, string>;
}

export interface ReadyPayload {
	ready: true;
}

export interface ReadyWithComponentPayload {
	rendered: true;
	renderedAt: string;
}

export interface ThemePayload {
	theme?: "light" | "dark";
	overrides: Record<string, string>;
}

export interface ResizePayload {
	height: number;
}

export interface CallbackPayload {
	name: string;
	payload: unknown;
}

export interface StateReadPayload {
	key: string;
}

export interface StateReadAckPayload {
	value: unknown;
}

export interface StateWritePayload {
	key: string;
	value: unknown;
}

export interface StateWriteAckPayload {
	ok: boolean;
}

export type ErrorCode =
	| "IMPORT_REJECTED"
	| "COMPILE_FAILED"
	| "RUNTIME_ERROR"
	| "CSP_VIOLATION";

export interface ErrorPayload {
	code: ErrorCode;
	message: string;
	detail?: string;
	stack?: string;
}

// --- envelope guard / mint helpers ----------------------------------------

/**
 * Mint a new `crypto.randomUUID()` channelId nonce. Used by the parent
 * controller at iframe construction time and embedded in every envelope
 * the parent sends.
 */
export function newChannelId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	// Fallback for older test environments — produces a 32-char hex
	// string that's unique enough for tests; production runs in modern
	// browsers where crypto.randomUUID is always present.
	let out = "";
	for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
	return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

export function newMsgId(): string {
	return newChannelId();
}

export function buildEnvelope<P>(
	kind: EnvelopeKind,
	payload: P,
	channelId: string,
	replyTo?: string,
): Envelope<P> {
	return {
		v: 1,
		kind,
		payload,
		msgId: newMsgId(),
		replyTo,
		channelId,
	};
}

/**
 * Shape-check and channelId-check inbound envelopes. Returns the
 * narrowed envelope when valid, null when the message should be
 * dropped. Production code drops silently and logs a structured
 * warning — never throws on hostile input.
 */
export function validateInboundEnvelope(
	raw: unknown,
	expectedChannelId: string,
): Envelope | null {
	if (!raw || typeof raw !== "object") return null;
	const candidate = raw as Record<string, unknown>;
	if (candidate.v !== 1) return null;
	if (typeof candidate.kind !== "string") return null;
	if (typeof candidate.msgId !== "string") return null;
	if (typeof candidate.channelId !== "string") return null;
	if (candidate.channelId !== expectedChannelId) return null;
	if (
		candidate.replyTo !== undefined &&
		typeof candidate.replyTo !== "string"
	)
		return null;
	const KNOWN_KINDS: EnvelopeKind[] = [
		"init",
		"ready",
		"ready-with-component",
		"theme",
		"resize",
		"callback",
		"state-read",
		"state-read-ack",
		"state-write",
		"state-write-ack",
		"error",
	];
	if (!KNOWN_KINDS.includes(candidate.kind as EnvelopeKind)) return null;
	return candidate as unknown as Envelope;
}

/**
 * No-secrets-in-payload defensive check. The architecture's
 * targetOrigin: "*" outbound posture is safe by construction only if
 * the parent never includes credentials in the payload. This helper
 * lets the parent controller fail-fast in dev/test if a developer
 * accidentally adds a credential field.
 */
const FORBIDDEN_PAYLOAD_FIELDS = [
	"apiKey",
	"token",
	"accessToken",
	"idToken",
	"refreshToken",
	"cognitoJwt",
	"sessionCookie",
	"authorization",
	"bearerToken",
	"tenantId",
	"userId",
	"principalId",
] as const;

export function assertNoSecretsInPayload(payload: unknown): void {
	const visited = new WeakSet<object>();
	const walk = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		// Cycle guard — defensive; LLM-authored payloads should not be
		// circular but we don't trust them by definition.
		const objRef = value as object;
		if (visited.has(objRef)) return;
		visited.add(objRef);

		if (Array.isArray(value)) {
			for (const item of value) walk(item);
			return;
		}

		const obj = value as Record<string, unknown>;
		for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(obj, field)) {
				throw new IframePayloadSecretLeakError(
					`Forbidden field '${field}' in iframe postMessage payload — the iframe runs untrusted LLM-authored code, payloads must never carry credentials. State proxy operations round-trip through the parent.`,
				);
			}
		}
		for (const v of Object.values(obj)) walk(v);
	};
	walk(payload);
}

export class IframePayloadSecretLeakError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IframePayloadSecretLeakError";
	}
}

/**
 * Build-time substituted globals.
 *
 * Vite's `define` plugin replaces bare identifier references at build
 * time. To get production substitution we MUST read the bare
 * identifier (e.g. `__SANDBOX_IFRAME_SRC__`), not a property read like
 * `globalThis.__SANDBOX_IFRAME_SRC__` — Vite's textual-replacement
 * pass is anchored on the bare-identifier syntax (or on explicitly
 * dotted define keys). Reading via `globalThis.X` would silently fall
 * through to the fallback in every production bundle, which is what
 * Codex flagged as a build-time blocker.
 *
 * The `typeof <identifier> !== "undefined"` guard is the standard
 * cross-environment pattern: in production after Vite substitutes
 * `__SANDBOX_IFRAME_SRC__` with the literal string, the typeof check
 * narrows to `"string"` and the read returns the build-time value;
 * in Vitest (no Vite `define`) the identifier is genuinely undeclared
 * and `typeof` returns `"undefined"` without throwing a ReferenceError,
 * so we fall through to the test-override path that reads
 * `globalThis.__SANDBOX_IFRAME_SRC__` for `vi.stubGlobal`-style tests.
 *
 * Keep in sync with the Terraform CSP frame-ancestors list (contract
 * v1 §CSP profile, U3 var.computer_sandbox_allowed_parent_origins).
 */

declare const __SANDBOX_IFRAME_SRC__: string;
declare const __ALLOWED_PARENT_ORIGINS__: readonly string[];

const SANDBOX_IFRAME_SRC_DEFAULT =
	"https://sandbox.thinkwork.ai/iframe-shell.html";

const ALLOWED_PARENT_ORIGINS_DEFAULT: readonly string[] = Object.freeze([
	"https://thinkwork.ai",
]);

/**
 * Production build-time-substituted iframe URL. Tests can override via
 * `globalThis.__SANDBOX_IFRAME_SRC__` (which only takes effect when
 * the bare identifier is undeclared — i.e. in Vitest where Vite
 * `define` has not run).
 */
export function resolveSandboxIframeSrc(): string {
	if (typeof __SANDBOX_IFRAME_SRC__ !== "undefined") {
		// Defensive: a zero-length build-time substitution would still
		// satisfy `typeof !== "undefined"` (and Vitest sees globalThis
		// assignments as bare-identifier hits). Treat empty as unset.
		if (
			typeof __SANDBOX_IFRAME_SRC__ === "string" &&
			__SANDBOX_IFRAME_SRC__.length > 0
		) {
			return __SANDBOX_IFRAME_SRC__;
		}
	}
	const fromGlobal = (
		globalThis as { __SANDBOX_IFRAME_SRC__?: string }
	).__SANDBOX_IFRAME_SRC__;
	return typeof fromGlobal === "string" && fromGlobal.length > 0
		? fromGlobal
		: SANDBOX_IFRAME_SRC_DEFAULT;
}

/**
 * Production build-time-substituted parent-origin allowlist. Tests
 * override via `globalThis.__ALLOWED_PARENT_ORIGINS__`.
 */
export function resolveAllowedParentOrigins(): readonly string[] {
	if (typeof __ALLOWED_PARENT_ORIGINS__ !== "undefined") {
		const list = __ALLOWED_PARENT_ORIGINS__;
		if (Array.isArray(list) && list.length > 0) {
			return Object.freeze([...list]);
		}
	}
	const fromGlobal = (
		globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
	).__ALLOWED_PARENT_ORIGINS__;
	if (Array.isArray(fromGlobal) && fromGlobal.length > 0) {
		return Object.freeze([...fromGlobal]);
	}
	return ALLOWED_PARENT_ORIGINS_DEFAULT;
}

/**
 * Eager-resolved exports for call sites that don't need to re-read at
 * runtime (e.g. iframe-shell's boot-time allowlist assertion). The
 * resolver helpers above are the testable surface; these constants
 * are the production read path.
 */
export const SANDBOX_IFRAME_SRC: string = resolveSandboxIframeSrc();
export const ALLOWED_PARENT_ORIGINS: readonly string[] =
	resolveAllowedParentOrigins();

/**
 * Defense: assert the allowlist never contains the dangerous values
 * "null" or "*". The iframe-shell test asserts this at build time.
 */
export function assertSafeAllowlist(
	allowlist: readonly string[] = ALLOWED_PARENT_ORIGINS,
): void {
	for (const origin of allowlist) {
		if (origin === "null" || origin === "*") {
			throw new Error(
				`Unsafe parent-origin allowlist entry: ${origin}. The iframe runs untrusted LLM code; ${origin} would accept messages from any origin (including hostile siblings under sandbox=allow-scripts). Use concrete https:// origins only.`,
			);
		}
	}
}
