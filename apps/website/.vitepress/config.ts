import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";
import { tabsMarkdownPlugin } from "vitepress-plugin-tabs";

import { buildSidebarFromNavigation, type NavigationItem } from "./build-sidebar.ts";

const navigationBedrock = loadNavigation("./docs/bedrock/api/navigation.json");
const navigationOcale = loadNavigation("./docs/ocale/api/navigation.json");

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
	title: "Bedrock",
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
