import type { ResolvedConfig } from "./schema.ts";

/** Every Kind that imports, in collection order. */
export const IMPORT_KINDS = ["gamePass", "developerProduct", "badge"] as const;

/** Kind whose Environment overlay entries accept `importId`. */
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Config collection of each Kind that imports. */
export const IMPORT_COLLECTIONS = {
	badge: "badges",
	developerProduct: "products",
	gamePass: "passes",
} as const satisfies Record<ImportKind, keyof NonNullable<ResolvedConfig["environments"][string]>>;

/** Name of each Kind that imports, as messages print it. */
export const IMPORT_KIND_NAMES: Readonly<Record<ImportKind, string>> = {
	badge: "badge",
	developerProduct: "developer product",
	gamePass: "game pass",
};
