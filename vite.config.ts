import { sharedConfig } from "@bedrock/vitest-config";

import { defineConfig } from "vite-plus";

const LOCAL_TSCONFIG = "./tsconfig.json";

export default defineConfig({
	...sharedConfig,
	run: {
		cache: {
			scripts: true,
			tasks: true,
		},
	},
	test: {
		projects: [
			{
				root: "./packages/cli",
				test: {
					...sharedConfig.test,
					typecheck: {
						...sharedConfig.test.typecheck,
						tsconfig: LOCAL_TSCONFIG,
					},
				},
			},
			{
				root: "./packages/open-cloud",
				test: {
					...sharedConfig.test,
					typecheck: {
						...sharedConfig.test.typecheck,
						tsconfig: LOCAL_TSCONFIG,
					},
				},
			},
			{
				root: "./apps/e2e",
				test: {
					...sharedConfig.test,
					environment: "jsdom",
					typecheck: {
						...sharedConfig.test.typecheck,
						tsconfig: LOCAL_TSCONFIG,
					},
				},
			},
		],
	},
});
