/**
 * Iframe-shell Vite build config (plan-012 U9 / U11.5).
 *
 * Emits a separate bundle that gets uploaded to the
 * `computer_sandbox_site` S3 bucket (the U3-provisioned subdomain
 * `sandbox.thinkwork.ai`). The bundle is loaded by the parent app via
 *   <iframe sandbox="allow-scripts" src={__SANDBOX_IFRAME_SRC__}>
 * and runs at an opaque cross-origin sandbox.
 *
 * Build-time defines:
 *   - __ALLOWED_PARENT_ORIGINS__: list of trusted parent origins; the
 *     iframe-shell uses this allowlist to validate `event.origin` on
 *     inbound parent messages. Read from VITE_ALLOWED_PARENT_ORIGINS
 *     (comma-separated). MUST mirror the Terraform CSP frame-ancestors
 *     value (var.computer_sandbox_allowed_parent_origins from U3).
 *
 *     Empty-string semantics (matters for stages where Terraform has
 *     intentionally not allowlisted any parent — frame-ancestors 'none'
 *     CSP): when VITE_ALLOWED_PARENT_ORIGINS is set to "" (the
 *     terraform output's empty default), we emit []. When the var is
 *     undefined entirely (local `vite dev` with no env file), we fall
 *     back to ["https://thinkwork.ai"]. This keeps the iframe-side
 *     allowlist in sync with the CSP and prevents silently allowing
 *     thinkwork.ai when the operator has explicitly disabled the
 *     sandbox.
 *
 *   - __SANDBOX_IFRAME_SRC__: the URL the parent uses for `iframe.src`.
 *     The iframe-shell itself doesn't need to know its own URL, but the
 *     parent controller does — both halves of the codebase share the
 *     same `iframe-protocol.ts` module so the constant is defined here
 *     too.
 *
 * Output:
 *   apps/computer/dist/iframe-shell/iframe-shell.html
 *   apps/computer/dist/iframe-shell/assets/*.js
 */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
	// Vite plugin code runs in Node and only sees process.env by
	// default. loadEnv merges .env / .env.<mode> / .env.local from the
	// envDir into the values seen here so deploy paths that write
	// .env.production (per scripts/build-computer.sh) are honored
	// without re-exporting inline.
	const env = loadEnv(mode, new URL(".", import.meta.url).pathname, [
		"VITE_",
	]);

	const rawOrigins =
		env.VITE_ALLOWED_PARENT_ORIGINS ??
		process.env.VITE_ALLOWED_PARENT_ORIGINS;

	const allowedParentOrigins = ((): string[] => {
		// undefined → operator hasn't supplied a value (typical for
		// local `vite dev`). Use the dev fallback so smoke runs work.
		if (rawOrigins === undefined) return ["https://thinkwork.ai"];

		// Defined (Terraform output present, possibly empty). Honor it
		// exactly. An empty string from Terraform means "no parent
		// allowlisted" — emit [] so the iframe-side allowlist matches
		// frame-ancestors 'none' on the CSP. Splitting "" gives [""],
		// which the filter drops to [].
		return rawOrigins
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	})();

	const sandboxIframeSrc =
		env.VITE_SANDBOX_IFRAME_SRC ||
		process.env.VITE_SANDBOX_IFRAME_SRC ||
		"https://sandbox.thinkwork.ai/iframe-shell.html";

	return {
		plugins: [react(), tailwindcss()],
		root: "src/iframe-shell",
		publicDir: false,
		resolve: {
			alias: {
				"@": new URL("./src", import.meta.url).pathname,
			},
		},
		define: {
			// amazon-cognito-identity-js polyfill (parity with the host
			// bundle's Vite config — even though the iframe-shell does
			// not use Cognito, transitive deps may reference `global`).
			global: "globalThis",
			__ALLOWED_PARENT_ORIGINS__: JSON.stringify(allowedParentOrigins),
			__SANDBOX_IFRAME_SRC__: JSON.stringify(sandboxIframeSrc),
		},
		build: {
			outDir: "../../dist/iframe-shell",
			emptyOutDir: true,
			rollupOptions: {
				input: "src/iframe-shell/iframe-shell.html",
			},
		},
		server: {
			// The parent iframe uses sandbox="allow-scripts" without
			// allow-same-origin, so the iframe document's module-script
			// requests have Origin: null. Mirror the production CloudFront
			// CORS policy in dev so the sandbox can actually execute.
			cors: true,
		},
	};
});
