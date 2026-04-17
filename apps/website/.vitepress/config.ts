import { defineConfig } from "vitepress";
import { tabsMarkdownPlugin } from "vitepress-plugin-tabs";

export default defineConfig({
	cleanUrls: true,
	description: "Infrastructure-as-Code for Roblox",
	lastUpdated: true,
	locales: {
		root: { label: "English", lang: "en-US" },
	},
	markdown: {
		config(md) {
			md.use(tabsMarkdownPlugin);
		},
	},
	srcDir: "docs",
	themeConfig: {
		nav: [
			{ link: "/", text: "Home" },
			{ link: "/ocale/guide/getting-started", text: "Ocale" },
		],
		sidebar: {
			"/ocale/": [
				{
					items: [{ link: "/ocale/guide/getting-started", text: "Getting Started" }],
					text: "Ocale",
				},
				{
					items: [
						{ link: "/ocale/guide/errors", text: "Errors" },
						{ link: "/ocale/api/index/type-aliases/Result", text: "Result" },
					],
					text: "Core",
				},
				{
					items: [
						{
							link: "/ocale/api/resources/game-passes/classes/GamePassesClient",
							text: "Game Passes",
						},
					],
					text: "Resources",
				},
			],
		},
		socialLinks: [{ icon: "github", link: "https://github.com/christopher-buss/bedrock" }],
	},
	title: "Bedrock",
});
