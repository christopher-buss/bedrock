import type { DefaultTheme } from "vitepress";

/**
 * Shape of a single entry in the `navigation.json` file emitted by
 * `typedoc-plugin-markdown`'s `navigationJson` option. Mirrored locally so the
 * sidebar builder does not depend on a deep import from the plugin.
 */
export interface NavigationItem {
	/** Nested entries when this item represents a group (kind, category, or module). */
	readonly children?: ReadonlyArray<NavigationItem>;
	/** Relative markdown path (e.g. `"interfaces/UniverseEntry.md"`) when the item has its own page. */
	readonly path?: null | string;
	/** Display title rendered in the sidebar. */
	readonly title: string;
}

/**
 * Transforms a TypeDoc navigation tree into a VitePress sidebar group. Leaves
 * become links, branches become collapsed groups, and items with neither path
 * nor children are dropped.
 * @param nav - Parsed `navigation.json` contents from a TypeDoc run.
 * @param basePath - Prefix prepended to every generated link (e.g. `"/bedrock/api/"`).
 * @returns Sidebar items ready to plug into `themeConfig.sidebar`.
 */
export function buildSidebarFromNavigation(
	nav: ReadonlyArray<NavigationItem>,
	basePath: string,
): Array<DefaultTheme.SidebarItem> {
	return nav.flatMap((item) => toSidebarItem(item, basePath) ?? []);
}

function toLink(path: string, basePath: string): string {
	return basePath + path.replace(/\.(?:md|html)$/u, "");
}

function toSidebarItem(
	item: NavigationItem,
	basePath: string,
): DefaultTheme.SidebarItem | undefined {
	const children = item.children ?? [];
	const items = children
		.map((child) => toSidebarItem(child, basePath))
		.filter((child): child is DefaultTheme.SidebarItem => child !== undefined);
	const link =
		typeof item.path === "string" && item.path.length > 0
			? toLink(item.path, basePath)
			: undefined;

	if (items.length > 0) {
		return link === undefined
			? { collapsed: true, items, text: item.title }
			: { collapsed: true, items, link, text: item.title };
	}

	if (link !== undefined) {
		return { link, text: item.title };
	}

	return undefined;
}
