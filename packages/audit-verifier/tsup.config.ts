import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: { index: "src/index.ts" },
		format: ["esm"],
		outDir: "dist",
		dts: true,
		clean: true,
		sourcemap: true,
		target: "es2022",
		platform: "node",
		// pg is an optional peer-style dep — keep it external so the bin
		// stays runnable when the auditor only does anchor verification
		// and never installs pg.
		external: ["pg"],
	},
	{
		entry: { "bin/audit-verifier": "src/bin/audit-verifier.ts" },
		format: ["esm"],
		outDir: "dist",
		clean: false,
		sourcemap: true,
		target: "es2022",
		platform: "node",
		banner: { js: "#!/usr/bin/env node" },
		external: ["pg"],
	},
]);
