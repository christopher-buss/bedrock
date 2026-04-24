import { sharedConfig } from "@bedrock/vite-config";

import { mergeConfig } from "vite-plus";

export default mergeConfig(sharedConfig, {
	test: {
		coverage: {
			include: [".vitepress/**/*.{ts,tsx}"],
		},
	},
});
