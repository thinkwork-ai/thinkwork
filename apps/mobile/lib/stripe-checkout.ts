/**
 * Mobile Stripe Checkout helper.
 *
 * Entry point for the pricing screen: POSTs to the existing
 * /api/stripe/checkout-session Lambda with mobile-specific successUrl +
 * cancelUrl, opens the returned hosted Checkout URL in an
 * ASWebAuthenticationSession via expo-web-browser, and returns a
 * discriminated union describing the outcome.
 *
 * The Stripe success_url is the web bounce page at
 * thinkwork.ai/m/checkout-complete?session_id={CHECKOUT_SESSION_ID}; its
 * JS fires a thinkwork:// scheme URL, iOS intercepts on match and closes
 * the auth session, and the promise resolves with result.type === "success"
 * + result.url === "thinkwork://onboarding/complete?session_id=…&paid=1".
 *
 * Follows the same literal-string pattern as auth-context.handleSignInWithGoogle
 * — no Linking.createURL, no preferEphemeralSession (forbidden by memory
 * feedback_mobile_oauth_ephemeral_session).
 */

import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import type { PlanId } from "@thinkwork/pricing-config";

// Literal return scheme (mirror auth-context.tsx:339 rationale — computed
// via Linking.createURL has broken tokens in the past).
const RETURN_SCHEME = "thinkwork://onboarding/complete";

const STRIPE_SESSION_TEMPLATE = "{CHECKOUT_SESSION_ID}";

// Resolve API base: prefer the build-time Expo constant so TestFlight
// builds target production by default; fall back to EXPO_PUBLIC_API_URL
// for local dev overrides; hardcode api.thinkwork.ai as the final net.
function resolveApiUrl(): string {
	const fromExtra =
		(Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
		"";
	const fromEnv = process.env.EXPO_PUBLIC_API_URL ?? "";
	return fromExtra || fromEnv || "https://api.thinkwork.ai";
}

export type StripeCheckoutResult =
	| { status: "completed"; sessionId: string }
	| { status: "cancel" }
	| { status: "dismiss" }
	| { status: "locked" }
	| { status: "error"; message: string };

export interface StripeCheckoutOptions {
	/**
	 * Cognito ID token. When present the Lambda treats this as an
	 * upgrade for the caller's existing tenant (sets
	 * client_reference_id = "tenant:<uuid>"); the webhook attaches the
	 * new subscription to that tenant rather than provisioning a new
	 * one. Omit for the signup flow from /onboarding/payment.
	 */
	bearerToken?: string;
}

export async function startStripeCheckout(
	planId: PlanId,
	opts: StripeCheckoutOptions = {},
): Promise<StripeCheckoutResult> {
	const apiUrl = resolveApiUrl().replace(/\/$/, "");

	const successUrl = `https://thinkwork.ai/m/checkout-complete?session_id=${STRIPE_SESSION_TEMPLATE}`;
	const cancelUrl = "https://thinkwork.ai/pricing";

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (opts.bearerToken) {
		headers.Authorization = `Bearer ${opts.bearerToken}`;
	}

	let checkoutUrl: string;
	try {
		const res = await fetch(`${apiUrl}/api/stripe/checkout-session`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				plan: planId,
				successUrl,
				cancelUrl,
			}),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as {
				error?: string;
			};
			return {
				status: "error",
				message:
					body.error ||
					`Checkout could not be started (HTTP ${res.status})`,
			};
		}
		const data = (await res.json()) as { url?: string };
		if (!data.url) {
			return {
				status: "error",
				message: "Checkout response did not include a URL",
			};
		}
		checkoutUrl = data.url;
	} catch (err) {
		const message =
			err instanceof Error
				? err.message
				: "Network error starting checkout";
		return { status: "error", message };
	}

	try {
		// Plain openAuthSessionAsync — NO preferEphemeralSession. The
		// ASWebAuthenticationSession cookie jar preserves Apple Pay and
		// card autofill across visits. See memory
		// feedback_mobile_oauth_ephemeral_session.
		const result = await WebBrowser.openAuthSessionAsync(
			checkoutUrl,
			RETURN_SCHEME,
		);

		if (result.type === "success") {
			// Parse session_id from thinkwork://onboarding/complete?session_id=...&paid=1.
			// Avoid `new URL()` — Hermes' URL polyfill has rough edges for
			// custom schemes. Match with a regex that tolerates `&` / `#`.
			const sessionMatch = result.url.match(/[?&]session_id=([^&#]+)/);
			const sessionId = sessionMatch?.[1]
				? decodeURIComponent(sessionMatch[1])
				: "";
			if (!sessionId) {
				return {
					status: "error",
					message: "Checkout completed but no session id returned",
				};
			}
			return { status: "completed", sessionId };
		}
		if (result.type === "cancel") return { status: "cancel" };
		if (result.type === "dismiss") return { status: "dismiss" };
		if (result.type === "locked") return { status: "locked" };
		// Any other/future result.type strings — treat as an error.
		return {
			status: "error",
			message: `Unexpected browser session result: ${String(result.type)}`,
		};
	} catch (err) {
		const message =
			err instanceof Error
				? err.message
				: "Browser session failed to open";
		return { status: "error", message };
	}
}

// Test-only resolver leak for the fetch-mock harness.
export const __testing = {
	resolveApiUrl,
	RETURN_SCHEME,
	STRIPE_SESSION_TEMPLATE,
};
