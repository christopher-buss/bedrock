import type { Theme } from "vitepress";
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client";
import DefaultTheme from "vitepress/theme";

export default {
	enhanceApp({ app }) {
		enhanceAppWithTabs(app);
	},
	extends: DefaultTheme,
} satisfies Theme;
