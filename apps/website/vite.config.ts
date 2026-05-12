import { sharedConfig } from "@bedrock-rbx/vite-config";
import vue from "@vitejs/plugin-vue";

import { mergeConfig } from "vite-plus";

import { shikiHighlightPlugin } from "./.vitepress/plugins/shiki-highlight.ts";

export default mergeConfig(sharedConfig, {
	plugins: [vue(), shikiHighlightPlugin()],
	test: {
		coverage: {
			include: [".vitepress/**/*.{ts,tsx,vue}"],
		},
		environment: "happy-dom",
	},
});
