import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

// E2E tests hit real Roblox Open Cloud endpoints, so the default 5 s timeout
// is tighter than publish-round-trip latency under retry. Coverage thresholds
// from the shared config are not meaningful here: this package has no
// production source, only scenario tests, so forcing 100 % would block CI.
//
// The `ssr.resolve.conditions` override mirrors packages/bedrock/vite.config.ts:
// workspace imports such as `@bedrock/core` must resolve via the `source`
// export condition so tests run against TypeScript source rather than a
// built `dist/` that only exists post-`pnpm build`.
export default mergeConfig(sharedConfig, {
	ssr: {
		resolve: {
			conditions: ["source", "module", "default"],
			externalConditions: ["source", "module", "default"],
		},
	},
	test: {
		coverage: {
			thresholds: undefined,
		},
		testTimeout: 60_000,
	},
});
