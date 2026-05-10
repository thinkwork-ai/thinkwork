// @vitest-environment node
/**
 * Build smoke proving the production Vite `define` substitution
 * actually lands in the bundle (plan-012, post-Codex-re-review).
 *
 * The earlier unit-level test mutated `globalThis.__SANDBOX_IFRAME_SRC__`
 * and re-imported the protocol module — that exercises the
 * test-fallback branch, NOT the production code path. Codex correctly
 * flagged that this is insufficient: in production, Vite's `define`
 * plugin must replace the bare identifier `__SANDBOX_IFRAME_SRC__` at
 * build time with the JSON-stringified URL from
 * VITE_SANDBOX_IFRAME_SRC. If the source ever regresses to a
 * `globalThis.__SANDBOX_IFRAME_SRC__` property read, the textual
 * replacement no longer fires and every production bundle silently
 * falls through to the default URL.
 *
 * This test invokes Vite's programmatic `build()` against the
 * iframe-shell config with stage-specific env values, then greps the
 * built JS for the configured URL + the configured allowlist origin.
 * If either is missing, the build-time injection regressed.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_COMPUTER_ROOT = resolve(__dirname, "../../..");

function readAllJs(dir: string): string {
	const entries = readdirSync(dir, { withFileTypes: true });
	const chunks: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			chunks.push(readAllJs(full));
		} else if (entry.isFile() && entry.name.endsWith(".js")) {
			chunks.push(readFileSync(full, "utf8"));
		}
	}
	return chunks.join("\n");
}

describe("Vite `define` build-time substitution (production smoke)", () => {
	it(
		"iframe-shell production bundle inlines VITE_SANDBOX_IFRAME_SRC + VITE_ALLOWED_PARENT_ORIGINS",
		async () => {
			const stagedUrl =
				"https://sandbox.dev-build-smoke.thinkwork.test/iframe-shell.html";
			const stagedOrigins = [
				"https://dev-build-smoke.thinkwork.test",
				"https://staging-build-smoke.thinkwork.test",
			];

			// Vite's build config reads VITE_* env vars from process.env at
			// config-load time (see vite.iframe-shell.config.ts: `const
			// allowedParentOrigins = ... process.env.VITE_ALLOWED_PARENT_ORIGINS`).
			// Stage them in process.env, build to a temp dir, then grep.
			const originalSrc = process.env.VITE_SANDBOX_IFRAME_SRC;
			const originalOrigins = process.env.VITE_ALLOWED_PARENT_ORIGINS;
			process.env.VITE_SANDBOX_IFRAME_SRC = stagedUrl;
			process.env.VITE_ALLOWED_PARENT_ORIGINS = stagedOrigins.join(",");

			const outDir = mkdtempSync(join(tmpdir(), "iframe-shell-smoke-"));
			try {
				await build({
					configFile: resolve(
						APPS_COMPUTER_ROOT,
						"vite.iframe-shell.config.ts",
					),
					root: APPS_COMPUTER_ROOT,
					logLevel: "error",
					build: {
						outDir,
						emptyOutDir: true,
						minify: false,
						sourcemap: false,
						write: true,
					},
				});

				const bundle = readAllJs(outDir);
				expect(bundle).toContain(stagedUrl);
				for (const origin of stagedOrigins) {
					expect(bundle).toContain(origin);
				}
				// The production-default URL still appears in the bundle
				// as the dead-code fallback inside resolveSandboxIframeSrc
				// (when minify: false the unreachable branch is kept).
				// The load-bearing assertion is that the STAGED URL is
				// inlined — that proves Vite's `define` substitution
				// actually fired against the bare identifier
				// `__SANDBOX_IFRAME_SRC__` and didn't fall through to the
				// fallback branch (which would have resolved to the
				// production default at runtime).
			} finally {
				rmSync(outDir, { recursive: true, force: true });
				if (originalSrc === undefined) {
					delete process.env.VITE_SANDBOX_IFRAME_SRC;
				} else {
					process.env.VITE_SANDBOX_IFRAME_SRC = originalSrc;
				}
				if (originalOrigins === undefined) {
					delete process.env.VITE_ALLOWED_PARENT_ORIGINS;
				} else {
					process.env.VITE_ALLOWED_PARENT_ORIGINS = originalOrigins;
				}
			}
		},
		{ timeout: 120_000 },
	);
});
