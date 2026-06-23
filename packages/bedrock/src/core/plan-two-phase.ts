import type { ResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";

/**
 * Split returned by {@link planTwoPhase}. `assetOps` is the subset applied in
 * the asset stage (every non-place op, so new IDs and mutable asset fields are
 * persisted before codegen runs); `placeOps` is the withheld place ops, replayed
 * verbatim to publish the pre-built file when codegen output is unchanged;
 * `markPlaces` is every declared place key the checkpoint write records as owing
 * a rebuild.
 */
export interface TwoPhasePlan {
	/** Non-place ops applied in the asset stage before codegen runs. */
	readonly assetOps: ReadonlyArray<Operation>;
	/** Every declared place key the checkpoint stamps with the pending-rebuild marker. */
	readonly markPlaces: ReadonlyArray<ResourceKey>;
	/** Withheld place ops, replayed to publish the pre-built file on an unchanged-codegen deploy. */
	readonly placeOps: ReadonlyArray<Operation>;
}

/**
 * Split a deploy's reconcile ops into the asset stage and the withheld place
 * ops. Place ops are held back from the asset stage so the asset stage mints new
 * IDs and persists mutable asset fields before codegen regenerates the place's
 * source; the caller then decides, from the freshly emitted codegen hash, whether to
 * republish the rebuilt bytes or replay `placeOps` to publish the pre-built file.
 *
 * Every declared place is marked (`markPlaces`), not a computed subset: the diff
 * carries no inter-resource edges, so any place could embed a value the asset
 * stage or codegen changed. The checkpoint re-marks them all on each retry and
 * the republish stage clears the marker per place it actually rebuilt, so the
 * marker persists only for places still owing a rebuild.
 *
 * Whether a deploy splits at all is the caller's decision (a rebuild hook plus
 * active codegen, or a leftover marker); this function only computes the split.
 *
 * @param ops - Reconcile operations produced by `diff`.
 * @returns The asset-stage op subset, the withheld place ops, and the places to mark.
 */
export function planTwoPhase(ops: ReadonlyArray<Operation>): TwoPhasePlan {
	const placeOps = ops.filter(isPlaceOp);
	return {
		assetOps: ops.filter((op) => !isPlaceOp(op)),
		markPlaces: placeOps.map((op) => op.key),
		placeOps,
	};
}

function isPlaceOp(op: Operation): boolean {
	return op.type === "noop" ? op.kind === "place" : op.desired.kind === "place";
}
