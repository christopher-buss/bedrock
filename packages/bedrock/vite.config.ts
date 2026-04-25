import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	pack: {
		entry: ["src/index.ts", "src/cli/run.ts"],
	},
	test: {
		coverage: {
			exclude: [...sharedConfig.test.coverage.exclude, "src/cli/run.ts"],
		},
	},
});
