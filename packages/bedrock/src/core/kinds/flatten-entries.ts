import { asResourceKey, type ResourceKey } from "../../types/ids.ts";
import type { RetiredInput } from "../flatten.ts";
import type { ResourceEntry, RetiredEntry } from "../schema.ts";

/**
 * Flattened entry of one kind: live input or a retirement marker.
 *
 * @template Live - Live desired input of the kind.
 * @template K - Kind tag shared by both members.
 */
export type FlattenedEntry<Live, K extends RetiredInput["kind"]> =
	| Live
	| (RetiredInput & { readonly kind: K });

/**
 * Flatten one keyed collection, passing markers through and carrying any
 * `movedFrom` onto the live input.
 *
 * @template K - Kind tag of the collection.
 * @template Entry - Live config entry shape.
 * @template Live - Live desired input shape.
 * @param entries - Resolved config collection.
 * @param options - Kind tag and live-input builder.
 * @param options.kind - Kind tag of the collection.
 * @param options.toLive - Builds the live input for one entry.
 * @returns One flattened input per key.
 */
export function flattenEntries<
	K extends RetiredInput["kind"],
	Entry extends { readonly movedFrom?: string | undefined },
	Live,
>(
	entries: Readonly<Record<string, ResourceEntry<Entry>>> | undefined,
	{
		kind,
		toLive,
	}: {
		readonly kind: K;
		readonly toLive: (key: ResourceKey, entry: Entry) => Live;
	},
): ReadonlyArray<FlattenedEntry<Live, K>> {
	return Object.entries(entries ?? {}).map<FlattenedEntry<Live, K>>(([name, entry]) => {
		const key = asResourceKey(name);
		if (isRetired(entry)) {
			return { key, kind, retired: entry.retired };
		}

		const live = toLive(key, entry);
		return entry.movedFrom === undefined ? live : { ...live, movedFrom: entry.movedFrom };
	});
}

function isRetired(entry: object): entry is RetiredEntry {
	return "retired" in entry;
}
