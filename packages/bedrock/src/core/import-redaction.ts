import type { ImportKind } from "./import-current.ts";
import type { ImportItem, ImportRefusal, ImportSelection } from "./import-plan-types.ts";
import {
	environmentOverride,
	REDACTED_BADGE_NAME,
	REDACTED_PASS_NAME,
	REDACTED_PRODUCT_NAME,
} from "./redact-resources.ts";
import type { Config } from "./schema.ts";

/**
 * A default developer-product placeholder: the shared name and a 6-hex suffix.
 */
const PRODUCT_PLACEHOLDER = new RegExp(`^${REDACTED_PRODUCT_NAME} [0-9a-f]{6}$`);

const DEFAULT_NAMES: Readonly<Record<Exclude<ImportKind, "developerProduct">, string>> = {
	badge: REDACTED_BADGE_NAME,
	gamePass: REDACTED_PASS_NAME,
};

/**
 * The mark an item of the source Environment carries when that
 * Environment's own `redacted` setting redacts it once imported (an
 * imported entry has no `redacted` field of its own).
 *
 * @param config - The project config.
 * @param environment - Name of the Environment the item is imported from.
 * @returns `{ redacted: true }` when its next deploy pushes placeholders for
 *   the item, else an empty object.
 */
export function redactionMark(config: Config, environment: string): Pick<ImportItem, "redacted"> {
	return environmentOverride(config.environments[environment]?.redacted) === undefined
		? {}
		: { redacted: true };
}

/**
 * The imported items whose Environment's next deploy replaces their live
 * values with placeholders.
 *
 * @param items - The live items of the source Environment.
 * @param plan - The selections and the refused ones among them.
 * @returns `kind:key` of each imported redacted item, in selection order.
 */
export function redactedImports(
	items: ReadonlyArray<ImportItem>,
	{
		refused,
		selections,
	}: {
		readonly refused: ReadonlyArray<ImportRefusal>;
		readonly selections: ReadonlyArray<ImportSelection>;
	},
): ReadonlyArray<string> {
	return selections.flatMap((selection) => {
		const item = items.find(sameItem(selection));
		return item?.redacted === true && !refused.some(sameItem(selection))
			? [`${selection.kind}:${selection.key ?? item.key}`]
			: [];
	});
}

/**
 * Whether a live item's name is a placeholder that its Environment's
 * redaction pushes, so it is not the item's real name.
 *
 * @param config - The project config.
 * @param item - The Environment, and the Kind and name of the item.
 * @returns `true` when the Environment redacts and the name is its
 *   placeholder name for the Kind.
 */
export function hasPlaceholderName(
	config: Config,
	{
		name,
		environment,
		kind,
	}: { readonly environment: string; readonly kind: ImportKind; readonly name: string },
): boolean {
	const override = environmentOverride(config.environments[environment]?.redacted);
	if (override === undefined) {
		return false;
	}

	if (override.name !== undefined) {
		return name === override.name;
	}

	return kind === "developerProduct"
		? PRODUCT_PLACEHOLDER.test(name)
		: name === DEFAULT_NAMES[kind];
}

function sameItem(
	one: Pick<ImportItem, "kind" | "robloxId">,
): (other: Pick<ImportItem, "kind" | "robloxId">) => boolean {
	return ({ kind, robloxId }) => kind === one.kind && robloxId === one.robloxId;
}
