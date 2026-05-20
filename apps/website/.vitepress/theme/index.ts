import type { Theme } from "vitepress";
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client";
import DefaultTheme from "vitepress/theme";

import Layout from "./layout.vue";

export default {
	enhanceApp({ app }) {
		enhanceAppWithTabs(app);
	},
	extends: DefaultTheme,

	Layout,
} satisfies Theme;
