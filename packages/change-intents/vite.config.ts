import { sharedConfig } from "@bedrock-rbx/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	test: {
		coverage: {
			exclude: [
				...sharedConfig.test.coverage.exclude,
				"src/gate-main.ts",
				"src/writer-main.ts",
			],
		},
		include: ["src/**/*.spec.ts"],
	},
});
