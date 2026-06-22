import type { Operation } from "./operations.ts";

/**
 * Decision returned by {@link planTwoPhase}. `activates` is `true` only when a
 * two-phase deploy should run; `assetOps` is the subset applied in the asset
 * stage (place ops withheld for the republish stage when active, otherwise the
 * full list).
 */
export interface TwoPhasePlan {
	/** Whether the deploy splits into an asset stage and a republish stage. */
	readonly activates: boolean;
	/** Ops applied in the asset stage; excludes place ops when `activates` is `true`. */
	readonly assetOps: ReadonlyArray<Operation>;
}

/**
 * Decide whether a deploy activates two-phase and which ops belong to the
 * asset stage. Two-phase activates only when a rebuild hook is supplied and the
 * diff contains a provisioned `create` (a `gamePass` or `developerProduct`
 * create, the kinds that mint a new Roblox ID). A `place` or `universe` create
 * adopts a user-supplied ID and does not trigger it.
 *
 * When active, place ops are withheld from `assetOps` so the asset stage mints
 * the new IDs before the place is rebuilt against them; when inactive,
 * `assetOps` is the full op list and the deploy applies in a single pass.
 *
 * @param ops - Reconcile operations produced by `diff`.
 * @param hookSupplied - Whether a rebuild hook is available for this deploy.
 * @returns The activation decision and the asset-stage op subset.
 */
export function planTwoPhase(ops: ReadonlyArray<Operation>, hookSupplied: boolean): TwoPhasePlan {
	const isActive = hookSupplied && ops.some(isProvisionedCreate);
	if (!isActive) {
		return { activates: false, assetOps: ops };
	}

	return { activates: true, assetOps: ops.filter((op) => !isPlaceOp(op)) };
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
