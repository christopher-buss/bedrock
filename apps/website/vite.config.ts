import { sharedConfig } from "@bedrock-rbx/vite-config";
import vue from "@vitejs/plugin-vue";

import { mergeConfig } from "vite-plus";

import { shikiHighlightPlugin } from "./.vitepress/plugins/shiki-highlight.ts";

export default mergeConfig(sharedConfig, {
	plugins: [vue(), shikiHighlightPlugin()],
	test: {
		coverage: {
			exclude: [
				".vitepress/**/*.spec.{ts,tsx}",
				".vitepress/config.ts",
				".vitepress/plugins/**",
				".vitepress/theme/index.ts",
			],
			include: [".vitepress/build-sidebar.ts", ".vitepress/theme/**/*.{ts,vue}"],
		},
		environment: "happy-dom",
	},
});
