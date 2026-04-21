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
	},
});
