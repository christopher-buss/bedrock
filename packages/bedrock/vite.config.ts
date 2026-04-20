import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	ssr: {
		resolve: {
			conditions: ["source", "module", "default"],
			externalConditions: ["source", "module", "default"],
		},
	},
});
