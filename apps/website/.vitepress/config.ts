import { readFileSync } from "node:fs";
import process from "node:process";
import { defineConfig } from "vitepress";
import { tabsMarkdownPlugin } from "vitepress-plugin-tabs";

import { buildSidebarFromNavigation, type NavigationItem } from "./build-sidebar.ts";
import { shikiHighlightPlugin } from "./plugins/shiki-highlight.ts";

const navigationBedrock = loadNavigation("./docs/bedrock/api/navigation.json");
const navigationOcale = loadNavigation("./docs/ocale/api/navigation.json");

const IS_PREVIEW_CHANNEL = process.env["BEDROCK_DOCS_CHANNEL"] === "next";

export default defineConfig({
	cleanUrls: true,
	description: "Infrastructure-as-Code for Roblox",
	head: [
		["link", { href: "https://fonts.googleapis.com", rel: "preconnect" }],
		["link", { crossorigin: "", href: "https://fonts.gstatic.com", rel: "preconnect" }],
		[
			"link",
			{
				href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700;1,800;1,900&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;1,8..60,400&display=swap",
				rel: "stylesheet",
			},
		],
	],
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
			...(IS_PREVIEW_CHANNEL
				? [{ link: "https://bedrock-livid.vercel.app/", text: "Latest release" }]
				: []),
		],
		sidebar: {
			"/bedrock/": [
				{
					items: [{ link: "/bedrock/guide/getting-started", text: "Getting Started" }],
					text: "Bedrock",
				},
				{
					collapsed: false,
					items: buildSidebarFromNavigation(navigationBedrock, "/bedrock/api/"),
					text: "API",
				},
			],
			"/ocale/": [
				{
					items: [
						{ link: "/ocale/guide/getting-started", text: "Getting Started" },
						{ link: "/ocale/guide/errors", text: "Errors" },
					],
					text: "Ocale",
				},
				{
					collapsed: false,
					items: buildSidebarFromNavigation(navigationOcale, "/ocale/api/"),
					text: "API",
				},
			],
		},
		socialLinks: [{ icon: "github", link: "https://github.com/christopher-buss/bedrock" }],
	},
	title: IS_PREVIEW_CHANNEL ? "Bedrock (preview)" : "Bedrock",
	vite: {
		plugins: [shikiHighlightPlugin()],
	},
});

function toNavigationItem(value: JSONValue): NavigationItem | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}

	const { children, path, title } = value;
	if (typeof title !== "string") {
		return undefined;
	}

	return {
		...(Array.isArray(children) && {
			children: children.flatMap((child) => toNavigationItem(child) ?? []),
		}),
		...(typeof path === "string" && { path }),
		title,
	};
}

function loadNavigation(path: string): Array<NavigationItem> {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(parsed) ? parsed.flatMap((item) => toNavigationItem(item) ?? []) : [];
	} catch {
		return [];
	}
}
