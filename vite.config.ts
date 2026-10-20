import { sharedConfig } from "@bedrock-rbx/vite-config";

import { defineConfig } from "vite-plus";

export default defineConfig({
	...sharedConfig,
	pack: undefined,
	run: {
		cache: {
			scripts: true,
			tasks: true,
		},
	},
	test: {
		...sharedConfig.test,
		coverage: {
			exclude: sharedConfig.test.coverage.exclude,
			include: sharedConfig.test.coverage.include,
			provider: sharedConfig.test.coverage.provider,
			reporter: ["text", "json", "html", "lcov"],
		},
		projects: ["packages/*", "apps/*"],
	},
});
