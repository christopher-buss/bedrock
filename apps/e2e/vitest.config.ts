import { sharedConfig } from "@bedrock-rbx/vite-config";

import { mergeConfig } from "vite-plus";

// Workspace imports such as `@bedrock-rbx/core` resolve via the `source`
// export condition, so tests run against TypeScript source; a built `dist/`
// only exists post-`pnpm build`.
//
// `module` is dropped, mirroring packages/state-s3/vite.config.ts: the AWS
// SDK's `module` build imports its own files without extensions, which only a
// bundler resolves, so the S3 smoke test fails to load under that condition.
// `node` picks the build node itself runs. These are set on the merged
// result, because `mergeConfig` concatenates arrays and would leave `module`
// ahead.
const CONDITIONS = ["source", "node", "default"] as const;

// E2E reads real credentials from the shell, so its workers keep the
// environment that the shared setup strips everywhere else. Replaced before
// the merge, because the merge concatenates arrays.
const sharedWithShellEnvironment = {
	...sharedConfig,
	test: { ...sharedConfig.test, setupFiles: ["@bedrock-rbx/testing/jest-extended"] },
};

export default {
	// E2E tests hit real Roblox Open Cloud endpoints, so the default 5 s
	// timeout is tighter than publish-round-trip latency under retry. Coverage
	// thresholds from the shared config are not meaningful here: this package
	// has no production source, only scenario tests, so forcing 100 % would
	// block CI.
	...mergeConfig(sharedWithShellEnvironment, {
		test: {
			coverage: {
				thresholds: undefined,
			},
			testTimeout: 60_000,
		},
	}),
	resolve: { conditions: [...CONDITIONS] },
	ssr: {
		resolve: { conditions: [...CONDITIONS], externalConditions: [...CONDITIONS] },
	},
};
