import type { ImportItemKind } from "./import-plan-types.ts";

/** Every Kind that imports, in collection order. */
export const IMPORT_KINDS = ["gamePass", "developerProduct", "badge"] as const;

/**
 * Kind whose Environment overlay entries accept `importId`.
 *
 * @since 0.5.0
 */
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Every Kind the import plan lists, in Kind order. */
export const IMPORT_ITEM_KINDS: ReadonlyArray<ImportItemKind> = [...IMPORT_KINDS, "place"];

/** Config collection of each Kind that imports. */
interface ImportCollections {
	readonly badge: "badges";
	readonly developerProduct: "products";
	readonly gamePass: "passes";
	readonly place: "places";
}

/** Config collection of each Kind that imports. */
export const IMPORT_COLLECTIONS: ImportCollections = {
	badge: "badges",
	developerProduct: "products",
	gamePass: "passes",
	place: "places",
};

/** Name of each Kind that imports, as messages print it. */
export const IMPORT_KIND_NAMES: Readonly<Record<ImportItemKind, string>> = {
	badge: "badge",
	developerProduct: "developer product",
	gamePass: "game pass",
	place: "place",
};
