/** Every Kind that imports, in collection order. */
export const IMPORT_KINDS = ["gamePass", "developerProduct", "badge"] as const;

/**
 * Kind whose Environment overlay entries accept `importId`.
 *
 * @since unreleased
 */
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Config collection of each Kind that imports. */
interface ImportCollections {
	readonly badge: "badges";
	readonly developerProduct: "products";
	readonly gamePass: "passes";
}

/** Config collection of each Kind that imports. */
export const IMPORT_COLLECTIONS: ImportCollections = {
	badge: "badges",
	developerProduct: "products",
	gamePass: "passes",
};

/** Name of each Kind that imports, as messages print it. */
export const IMPORT_KIND_NAMES: Readonly<Record<ImportKind, string>> = {
	badge: "badge",
	developerProduct: "developer product",
	gamePass: "game pass",
};
