import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

function addTestingSubpath(
	exportsMap: Record<string, unknown>,
	context: { isPublish: boolean },
): Record<string, unknown> {
	if (context.isPublish) {
		return exportsMap;
	}

	exportsMap["./testing"] = { source: "./tests/helpers/index.ts" };
	return exportsMap;
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
