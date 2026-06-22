import type { ResourceKey } from "../types/ids.ts";
import type { Operation } from "./operations.ts";

/**
 * Decision returned by {@link planTwoPhase}. `activates` is `true` only when a
 * two-phase deploy should run; `assetOps` is the subset applied in the asset
 * stage (place ops withheld for the republish stage when active, otherwise the
 * full list); `markPlaces` is the place keys the checkpoint write records as
 * owing a rebuild.
 */
export interface TwoPhasePlan {
	/** Whether the deploy splits into an asset stage and a republish stage. */
	readonly activates: boolean;
	/** Ops applied in the asset stage; excludes place ops when `activates` is `true`. */
	readonly assetOps: ReadonlyArray<Operation>;
	/** Place keys the checkpoint write stamps with the pending-rebuild marker; empty when inactive. */
	readonly markPlaces: ReadonlyArray<ResourceKey>;
}

/**
 * Decide whether a deploy activates two-phase, which ops belong to the asset
 * stage, and which places the checkpoint marks as owing a rebuild. Two-phase
 * activates when either the diff contains a provisioned `create` (a `gamePass`
 * or `developerProduct` create, the kinds that mint a new Roblox ID) or a place
 * still carries a pending-rebuild marker from a prior run that never finished
 * its republish. A `place` or `universe` create adopts a user-supplied ID and
 * does not trigger it on its own. The caller gates on rebuild-hook availability
 * before calling, so this decision assumes a hook is present.
 *
 * When active, place ops are withheld from `assetOps` so the asset stage mints
 * the new IDs before the place is rebuilt against them; when inactive,
 * `assetOps` is the full op list and the deploy applies in a single pass.
 *
 * When active, every declared place is marked (`markPlaces`), not a computed
 * subset: the diff carries no inter-resource edges, so any place could embed a
 * newly minted ID. The checkpoint re-marks them all on each retry and the
 * republish stage clears the marker per place it actually rebuilt, so the marker
 * persists only for places still owing a rebuild.
 *
 * @param ops - Reconcile operations produced by `diff`.
 * @param marker - Place keys carried over from the prior state's pending-rebuild
 *   marker; a non-empty marker re-activates two-phase even without a create.
 * @returns The activation decision, the asset-stage op subset, and the places to mark.
 */
export function planTwoPhase(
	ops: ReadonlyArray<Operation>,
	marker: ReadonlySet<ResourceKey>,
): TwoPhasePlan {
	const isActive = ops.some(isProvisionedCreate) || marker.size > 0;
	if (!isActive) {
		return { activates: false, assetOps: ops, markPlaces: [] };
	}

	const markPlaces = ops.filter(isPlaceOp).map((op) => op.key);
	return { activates: true, assetOps: ops.filter((op) => !isPlaceOp(op)), markPlaces };
}

function isProvisionedCreate(op: Operation): boolean {
	return (
		op.type === "create" &&
		(op.desired.kind === "gamePass" || op.desired.kind === "developerProduct")
	);
}

function isPlaceOp(op: Operation): boolean {
	return op.type === "noop" ? op.kind === "place" : op.desired.kind === "place";
}
