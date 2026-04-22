import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"src/**/*.test.ts",
			// Unit 8 — integration tests for the skill-runs surface. They
			// use the harness under test/integration/skill-runs/_harness/
			// and never talk to real infra. See that directory's README.
			"test/integration/**/*.test.ts",
		],
		// Sandbox E2E tests hit live infra (deployed stage). They are
		// opted into via `pnpm sandbox:e2e` (separate config below).
		// Keeping them out of the default run means `pnpm test` stays
		// hermetic. See packages/api/test/integration/sandbox/README.md.
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"test/integration/sandbox/**",
		],
	},
});
