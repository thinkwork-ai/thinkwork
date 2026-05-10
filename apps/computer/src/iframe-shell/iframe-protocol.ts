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
	if (!payload || typeof payload !== "object") return;
	const obj = payload as Record<string, unknown>;
	for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
		if (field in obj) {
			throw new IframePayloadSecretLeakError(
				`Forbidden field '${field}' in iframe postMessage payload — the iframe runs untrusted LLM-authored code, payloads must never carry credentials. State proxy operations round-trip through the parent.`,
			);
		}
	}
}

export class IframePayloadSecretLeakError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IframePayloadSecretLeakError";
	}
}

/**
 * Build-time injected sandbox iframe URL — Vite's `define` substitutes
 * `__SANDBOX_IFRAME_SRC__` at build time per stage.
 *
 * In test environments (vitest), the substitution is the literal string
 * `__SANDBOX_IFRAME_SRC__`, so the function below resolves a sentinel
 * that test fixtures override.
 */
export const SANDBOX_IFRAME_SRC: string =
	(globalThis as { __SANDBOX_IFRAME_SRC__?: string }).__SANDBOX_IFRAME_SRC__ ??
	"https://sandbox.thinkwork.ai/iframe-shell.html";

/**
 * Build-time injected list of trusted parent origins. The iframe-shell
 * uses this to validate `event.origin` on inbound parent messages.
 * Keep in sync with the Terraform CSP frame-ancestors list (contract v1
 * §CSP profile, U3 var.computer_sandbox_allowed_parent_origins).
 */
export const ALLOWED_PARENT_ORIGINS: readonly string[] = (() => {
	const fromGlobal = (
		globalThis as { __ALLOWED_PARENT_ORIGINS__?: string[] }
	).__ALLOWED_PARENT_ORIGINS__;
	if (Array.isArray(fromGlobal) && fromGlobal.length > 0) {
		return Object.freeze([...fromGlobal]);
	}
	// Default fallback — production builds substitute these via Vite
	// `define` at build time; tests override via the global.
	return Object.freeze(["https://thinkwork.ai"]);
})();

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
