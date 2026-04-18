import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

function addTestingSubpath(
	exports: Record<string, unknown>,
	context: { isPublish: boolean },
): Record<string, unknown> {
	if (context.isPublish) {
		return exports;
	}

	return {
		...exports,
		"./testing": { source: "./tests/helpers/index.ts" },
	};
}

export default mergeConfig(sharedConfig, {
	pack: {
		entry: {
			"game-passes": "src/resources/game-passes/index.ts",
			"index": "src/index.ts",
		},
		exports: {
			customExports: addTestingSubpath,
		},
	},
});
