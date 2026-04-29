import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"src/**/*.test.ts",
			// One-shot scripts that mutate prod data (backfills, wipes)
			// live under scripts/ to keep them out of the normal API
			// entry-point graph. Their logic is still unit-tested with
			// mocked db.execute.
			"scripts/**/*.test.ts",
			// Unit 8 — integration tests for the skill-runs surface. They
			// use the harness under test/integration/skill-runs/_harness/
			// and never talk to real infra. See that directory's README.
			"test/integration/**/*.test.ts",
		],
		// Sandbox E2E tests hit live infra (deployed stage). They are
		// opted into via `pnpm sandbox:e2e` (separate config below).
		// The `.e2e.test.ts` extension marks live-infra tests; other
		// `.test.ts` files inside test/integration/sandbox/ (pure
		// logic) still run under the default config. See
		// packages/api/test/integration/sandbox/README.md.
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"test/integration/sandbox/**/*.e2e.test.ts",
		],
	},
});
