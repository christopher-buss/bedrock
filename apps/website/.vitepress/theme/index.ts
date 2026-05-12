import type { Theme } from "vitepress";
import { enhanceAppWithTabs } from "vitepress-plugin-tabs/client";
import DefaultTheme from "vitepress/theme";

import Layout from "./layout.vue";

export default {
	enhanceApp({ app }) {
		enhanceAppWithTabs(app);
	},
	extends: DefaultTheme,
	// eslint-disable-next-line ts/no-unsafe-assignment -- @isentinel/eslint-config has no vue-eslint-parser; *.vue shim resolves for tsgo but typescript-eslint sees DefineComponent as error-typed
	Layout,
} satisfies Theme;
