import { sharedConfig } from "@bedrock-rbx/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	test: {
		include: ["src/**/*.spec.ts"],
	},
});
