import { sharedConfig, sortExports } from "@bedrock-rbx/vite-config";

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
	if (!context.isPublish) {
		exportsMap["./testing"] = {
			default: "./tests/helpers/index.ts",
			source: "./tests/helpers/index.ts",
		};
	}

	return sortExports(exportsMap);
}

export default mergeConfig(sharedConfig, {
	pack: {
		entry: {
			"badges": "src/resources/badges/index.ts",
			"developer-products": "src/resources/developer-products/index.ts",
			"game-passes": "src/resources/game-passes/index.ts",
			"index": "src/index.ts",
			"locales": "src/locales/index.ts",
			"luau-execution": "src/resources/luau-execution/index.ts",
			"places": "src/resources/places/index.ts",
			"storage": "src/resources/storage/index.ts",
			"universes": "src/resources/universes/index.ts",
		},
		exports: {
			customExports: addTestingSubpath,
		},
	},
});
