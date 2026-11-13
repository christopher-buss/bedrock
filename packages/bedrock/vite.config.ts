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
		// No entry imports the config editor yet, so the build does not see
		// its parser. Remove this once the import command uses the editor.
		unused: { ...sharedConfig.pack.unused, ignore: ["oxc-parser"] },
	},
	test: {
		coverage: {
			exclude: [...sharedConfig.test.coverage.exclude, "src/cli/run.ts"],
		},
	},
});
