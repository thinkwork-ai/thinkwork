/**
 * Iframe-shell Vite build config (plan-012 U9).
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
 *   - __SANDBOX_IFRAME_SRC__: the URL the parent uses for `iframe.src`.
 *     The iframe-shell itself doesn't need to know its own URL, but the
 *     parent controller does — for now both halves of the codebase
 *     share the same `iframe-protocol.ts` module, so the constant is
 *     defined here too. U10 wires the parent build to receive the same
 *     value.
 *
 * Output:
 *   apps/computer/dist/iframe-shell/index.html
 *   apps/computer/dist/iframe-shell/assets/*.js
 *
 * Inert-first: U9 ships the bundle but no parent code mounts it. U10
 * wires the parent IframeAppletController; U11 cuts production paths
 * over.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const allowedParentOrigins = (() => {
	const raw = process.env.VITE_ALLOWED_PARENT_ORIGINS ?? "";
	const list = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (list.length === 0) return ["https://thinkwork.ai"];
	return list;
})();

const sandboxIframeSrc =
	process.env.VITE_SANDBOX_IFRAME_SRC ??
	"https://sandbox.thinkwork.ai/iframe-shell.html";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	root: "src/iframe-shell",
	publicDir: false,
	resolve: {
		alias: {
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
	define: {
		// amazon-cognito-identity-js polyfill (parity with the host bundle's
		// Vite config — even though the iframe-shell does not use Cognito,
		// transitive deps may reference `global`).
		global: "globalThis",
		__ALLOWED_PARENT_ORIGINS__: JSON.stringify(allowedParentOrigins),
		__SANDBOX_IFRAME_SRC__: JSON.stringify(sandboxIframeSrc),
	},
	build: {
		outDir: "../../dist/iframe-shell",
		emptyOutDir: true,
		rollupOptions: {
			input: "src/iframe-shell/index.html",
		},
	},
});
