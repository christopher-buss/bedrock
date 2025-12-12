import { sharedConfig } from "@bedrock/vitest-config";

import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	sharedConfig,
	defineConfig({
		test: {
			// package-specific overrides if needed
		},
	}),
);
