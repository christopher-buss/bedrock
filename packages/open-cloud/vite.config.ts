import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	pack: {
		entry: {
			"game-passes": "src/resources/game-passes/index.ts",
			"index": "src/index.ts",
		},
	},
});
