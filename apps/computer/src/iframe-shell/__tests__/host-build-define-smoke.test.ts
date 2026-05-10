// @vitest-environment node
/**
 * Host build smoke proving the actual deploy path works (plan-012,
 * post-Codex-final-review).
 *
 * scripts/build-computer.sh writes apps/computer/.env.production from
 * Terraform outputs and then invokes `pnpm --filter computer build`
 * WITHOUT re-exporting VITE_SANDBOX_IFRAME_SRC inline. Vite plugin
 * code inside the config runs in Node and only sees process.env by
 * default — it does NOT auto-load .env.production for plugin/define
 * logic. Calling Vite's loadEnv() inside defineConfig is the
 * authoritative fix.
 *
 * This smoke writes a temp .env.production into apps/computer/, runs
 * the host build with NO inline env, then greps the bundle for the
 * staged URL. If anyone ever drops the loadEnv call, this test
 * catches it because the bundle will fall back to the production
 * default URL instead of the staged one.
 */

import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	existsSync,
	writeFileSync,
	renameSync,
	unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_COMPUTER_ROOT = resolve(__dirname, "../../..");
const HOST_ENV_FILE = join(APPS_COMPUTER_ROOT, ".env.production");

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

describe("Host Vite config — .env.production deploy-path smoke", () => {
	it(
		"host bundle inlines VITE_SANDBOX_IFRAME_SRC from .env.production WITHOUT inline env",
		async () => {
			const stagedUrl =
				"https://sandbox.dev-host-envfile.thinkwork.test/iframe-shell.html";

			// Preserve any existing .env.production so this test doesn't
			// trash a developer's local file. Stash + restore in finally.
			let stashedEnvFile: string | null = null;
			const stashPath = `${HOST_ENV_FILE}.smoke-stash-${Date.now()}`;
			if (existsSync(HOST_ENV_FILE)) {
				renameSync(HOST_ENV_FILE, stashPath);
				stashedEnvFile = stashPath;
			}
			// Defensive: clear any inline env so this test ONLY exercises
			// the .env.production path. If a developer has the var set in
			// their shell, the assertion would still hold but the proof
			// would be ambiguous.
			const originalInline = process.env.VITE_SANDBOX_IFRAME_SRC;
			delete process.env.VITE_SANDBOX_IFRAME_SRC;

			const outDir = mkdtempSync(join(tmpdir(), "host-envfile-smoke-"));
			try {
				writeFileSync(
					HOST_ENV_FILE,
					[
						"# Staged by host-build-define-smoke.test.ts — do not commit.",
						`VITE_SANDBOX_IFRAME_SRC=${stagedUrl}`,
						"",
					].join("\n"),
					"utf8",
				);

				await build({
					configFile: resolve(APPS_COMPUTER_ROOT, "vite.config.ts"),
					root: APPS_COMPUTER_ROOT,
					mode: "production",
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
			} finally {
				if (existsSync(HOST_ENV_FILE)) unlinkSync(HOST_ENV_FILE);
				if (stashedEnvFile) {
					renameSync(stashedEnvFile, HOST_ENV_FILE);
				}
				if (originalInline === undefined) {
					delete process.env.VITE_SANDBOX_IFRAME_SRC;
				} else {
					process.env.VITE_SANDBOX_IFRAME_SRC = originalInline;
				}
				rmSync(outDir, { recursive: true, force: true });
			}
		},
		{ timeout: 180_000 },
	);
});
