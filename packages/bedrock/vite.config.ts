import { rawText, sharedConfig } from "@bedrock-rbx/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	pack: {
		copy: [{ from: "src/luau/config.luau", to: "dist/luau" }],
		entry: ["src/index.ts", "src/cli/run.ts", "src/config.ts"],
		exports: {
			...sharedConfig.pack.exports,
			bin: {
				bedrock: "./src/cli/run.ts",
			},
		},
		plugins: [rawText],
	},
	test: {
		coverage: {
			exclude: [...sharedConfig.test.coverage.exclude, "src/cli/run.ts"],
		},
	},
});
