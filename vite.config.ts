import { sharedConfig } from "@bedrock/vite-config";

import { defineConfig } from "vite-plus";

export default defineConfig({
	...sharedConfig,
	pack: undefined,
	run: {
		cache: {
			scripts: true,
			tasks: true,
		},
	},
	test: { projects: ["packages/*", "apps/*"] },
});
