import type { RobloxAssetId } from "../types/ids.ts";
import type { ImportKind } from "./import-current.ts";
import { IMPORT_COLLECTIONS } from "./import-kinds.ts";
import { extractDisplayNamePrefix } from "./migrate/extract-display-name-prefix.ts";

const KIND_SLUGS: Readonly<Record<ImportKind, string>> = {
	badge: "badge",
	developerProduct: "developer-product",
	gamePass: "game-pass",
};

/**
 * Repository path for the icon file of an imported entry.
 *
 * @param kind - Kind of the entry.
 * @param key - Key of the entry.
 * @returns `assets/<collection>/<key>.png`.
 */
export function importIconPath(kind: ImportKind, key: string): string {
	return `assets/${IMPORT_COLLECTIONS[kind]}/${key}.png`;
}

/**
 * Suggest a Key for a live item: the name without its display-name prefix,
 * kebab-cased, suffixed `-2`, `-3` while the Key is taken. A name with no
 * letters or digits gives `<kind>-<id>`.
 *
 * @param item - Kind, name on Roblox and Roblox ID of the item.
 * @param taken - Keys already in use.
 * @returns The suggested Key.
 */
export function suggestImportKey(
	{
		name,
		...item
	}: { readonly kind: ImportKind; readonly name: string; readonly robloxId: RobloxAssetId },
	taken: ReadonlySet<string>,
): string {
	const base = baseKey(name, item);
	let key = base;
	let suffix = 2;
	while (taken.has(key)) {
		key = `${base}-${String(suffix)}`;
		suffix += 1;
	}

	return key;
}

function baseKey(
	name: string,
	{ kind, robloxId }: { readonly kind: ImportKind; readonly robloxId: RobloxAssetId },
): string {
	const kebab = extractDisplayNamePrefix(name)
		.body.normalize("NFKD")
		.replaceAll(/([a-z\d])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replaceAll(/[^a-z\d]+/g, "-")
		.replaceAll(/^-|-$/g, "");
	return kebab === "" ? `${KIND_SLUGS[kind]}-${robloxId}` : kebab;
}
