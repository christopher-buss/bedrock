import type { ResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";

/**
 * Keys of the places a reconcile would publish, which Roblox accepts only
 * with an API key.
 *
 * The place driver publishes whenever the desired place has a `filePath`, on
 * create and on update, also when only metadata changed. A noop dispatches
 * nothing.
 *
 * @param ops - The reconcile operations from `diff`.
 * @returns The keys of the place ops that publish, in op order.
 */
export function placesNeedingApiKey(ops: ReadonlyArray<Operation>): ReadonlyArray<ResourceKey> {
	return ops
		.filter((op) => {
			return (
				op.type !== "noop" &&
				op.desired.kind === "place" &&
				op.desired.filePath !== undefined
			);
		})
		.map((op) => op.key);
}
