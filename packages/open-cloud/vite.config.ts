import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";
import type { ExportsOptions } from "vite-plus/pack";

type CustomExportsFunc = Extract<
	NonNullable<ExportsOptions["customExports"]>,
	(...args: never) => unknown
>;

function addTestingSubpath(
	exportsMap: Parameters<CustomExportsFunc>[0],
	context: Parameters<CustomExportsFunc>[1],
): ReturnType<CustomExportsFunc> {
	if (context.isPublish) {
		return exportsMap;
	}

	exportsMap["./testing"] = {
		default: "./tests/helpers/index.ts",
		source: "./tests/helpers/index.ts",
	};
	return exportsMap;
}

export default mergeConfig(sharedConfig, {
	pack: {
		entry: {
			"game-passes": "src/resources/game-passes/index.ts",
			"index": "src/index.ts",
			"places": "src/resources/places/index.ts",
		},
		exports: {
			customExports: addTestingSubpath,
		},
	},
});
