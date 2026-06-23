import { sharedConfig } from "@bedrock-rbx/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	test: {
		coverage: {
			exclude: [...sharedConfig.test.coverage.exclude, "src/main.ts"],
		},
	},
});
