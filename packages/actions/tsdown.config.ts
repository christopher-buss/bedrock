import { defineConfig } from "tsdown";

/**
 * Bundle the commit-back action shim into a single self-contained file the
 * GitHub Actions node24 runtime executes. Dependencies (e.g. `@actions/core`)
 * are inlined so the consumed action ref needs no `node_modules`.
 */
export default defineConfig({
	dts: false,
	entry: { index: "src/main.ts" },
	format: "esm",
	outDir: "dist",
	platform: "node",
	target: "node24",
});
