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
			{ link: "/bedrock/guide/getting-started", text: "Bedrock" },
			{ link: "/ocale/guide/getting-started", text: "Ocale" },
		],
		// Links into /ocale/api/** and /bedrock/api/** point at paths that
		// typedoc-plugin-markdown generates from each package's public API. If
		// typedoc or the plugin is upgraded and changes its output layout,
		// these links must be updated manually — there's no compile-time check
		// that they resolve.
		sidebar: {
			"/bedrock/": [
				{
					items: [{ link: "/bedrock/guide/getting-started", text: "Getting Started" }],
					text: "Bedrock",
				},
				{
					items: [
						{ link: "/bedrock/api/index/functions/diff", text: "diff" },
						{ link: "/bedrock/api/index/type-aliases/Operation", text: "Operation" },
						{
							link: "/bedrock/api/index/type-aliases/ResourceDesiredState",
							text: "ResourceDesiredState",
						},
						{
							link: "/bedrock/api/index/type-aliases/ResourceCurrentState",
							text: "ResourceCurrentState",
						},
						{
							link: "/bedrock/api/index/interfaces/BedrockState",
							text: "BedrockState",
						},
					],
					text: "Core",
				},
				{
					items: [
						{ link: "/bedrock/api/index/functions/applyOps", text: "applyOps" },
						{
							link: "/bedrock/api/index/functions/buildDesired",
							text: "buildDesired",
						},
					],
					text: "Shell",
				},
				{
					items: [
						{
							link: "/bedrock/api/index/interfaces/ResourceDriver",
							text: "ResourceDriver",
						},
						{ link: "/bedrock/api/index/interfaces/StatePort", text: "StatePort" },
					],
					text: "Ports",
				},
				{
					items: [
						{
							link: "/bedrock/api/index/type-aliases/ResourceKey",
							text: "Branded IDs",
						},
					],
					text: "Types",
				},
			],
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
